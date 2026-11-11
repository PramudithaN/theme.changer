import type { Snapshot } from '../capture/capture';
import type { Theme } from '../ui/theme';
import { createProgram, type Program } from './program';
import { createNoiseTexture } from './noiseTexture';
import { inkParams, getRimColor } from './params';
import { FULLSCREEN_VERT, INK_FRAG } from './shaders';

interface ThemeTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  scale: number;
  key: string;
  isViewport: boolean;
  scrollX: number;
  scrollY: number;
  captureMs: number;
}

/** Offscreen copy of what the overlay showed when a transition was interrupted. */
interface CompositeTexture {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
  /** Page scroll (CSS px) at the moment it was rendered. */
  scrollX: number;
  scrollY: number;
}

/** What the ink spreads *over*: a theme snapshot, or the frozen mid-transition frame. */
export type InkSource = Theme | 'composite';

export interface InkFrame {
  from: InkSource;
  to: Theme;
  /** Click point, CSS px relative to the viewport. */
  center: { x: number; y: number };
  /** Eased 0..1. */
  progress: number;
  /** Base radius, CSS px. */
  radius: number;
  /** Uniform extra reach used to finish off lagging corners, CSS px. */
  cleanup: number;
  /** Distance from the click to the farthest viewport corner, CSS px. */
  maxDist: number;
  /** Seconds since the click (already slow-mo scaled). */
  time: number;
  /** Per-click randomness. */
  seed: { x: number; y: number; angle: number };
}

interface Sampler {
  texture: WebGLTexture;
  width: number;
  height: number;
  /** Texture px per canvas device px. */
  ratio: number;
  /** Texture px added after scaling (scroll), already rounded to whole texels. */
  offsetX: number;
  offsetY: number;
  /** Framebuffer-rendered textures are bottom-up. */
  flipY: boolean;
}

/** Owns the overlay canvas, the WebGL2 context and the snapshot / composite textures. */
export class InkRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly maxTextureSize: number;

  private gl: WebGL2RenderingContext;
  private program!: Program;
  private vao!: WebGLVertexArrayObject;
  private noise!: WebGLTexture;
  private textures = new Map<Theme, ThemeTexture>();
  private composites: CompositeTexture[] = [];
  private activeComposite = -1;
  private canvasScale = 1;
  private lost = false;

  /** Returns null when WebGL2 is unavailable. */
  static create(canvas: HTMLCanvasElement): InkRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false, // opaque: CSS opacity fades it straight onto the live DOM
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;
    try {
      return new InkRenderer(canvas, gl);
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.init();
  }

  private init(): void {
    const gl = this.gl;
    this.program = createProgram(gl, FULLSCREEN_VERT, INK_FRAG);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    this.vao = vao;
    this.noise = createNoiseTexture(gl);
  }

  /**
   * Registers context-loss listeners. The caller should drop any pending animation, then
   * re-upload fresh snapshots once restored.
   */
  watchContext(onLost: () => void, onRestored: () => void): void {
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.textures.clear();
      this.composites = [];
      this.activeComposite = -1;
      onLost();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.init();
      onRestored();
    });
  }

  get isLost(): boolean {
    return this.lost;
  }

  getLastCaptureMs(): number {
    let max = 0;
    for (const t of this.textures.values()) {
      if (t.captureMs > max) max = t.captureMs;
    }
    return max;
  }

  /** Sizes the backing store to the overlay's CSS box at the given DPR. */
  resize(scale: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * scale));
    const h = Math.max(1, Math.round(rect.height * scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvasScale = rect.width > 0 ? w / rect.width : scale;
  }

  upload(snapshot: Snapshot): void {
    if (this.lost) return;
    const gl = this.gl;
    let entry = this.textures.get(snapshot.theme);
    if (!entry) {
      entry = {
        texture: this.createTexture(),
        width: 0,
        height: 0,
        scale: 0,
        key: '',
        isViewport: false,
        scrollX: 0,
        scrollY: 0,
        captureMs: 0,
      };
      this.textures.set(snapshot.theme, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, snapshot.canvas);
    entry.width = snapshot.canvas.width;
    entry.height = snapshot.canvas.height;
    entry.scale = snapshot.scale;
    entry.key = snapshot.key;
    entry.isViewport = snapshot.isViewport;
    entry.scrollX = snapshot.scrollX;
    entry.scrollY = snapshot.scrollY;
    entry.captureMs = snapshot.ms;
  }

  /** True when a snapshot for `theme` exists and is valid for the current viewport. */
  hasValid(theme: Theme, key: string): boolean {
    const t = this.textures.get(theme);
    if (this.lost || !t || !t.texture) return false;
    if (t.key === key) return true;
    // Valid if viewport dimensions match and scroll position is within 30px
    if (t.width === this.canvas.width && t.height === this.canvas.height && Math.abs(window.scrollY - t.scrollY) < 30) {
      return true;
    }
    return false;
  }

  /**
   * Renders `frame` (normally: exactly what is on screen) into an offscreen texture that
   * later frames can use as `from: 'composite'`. Two textures ping-pong, so a frame that
   * itself reads the composite can be frozen again (rapid triple-clicks).
   */
  freeze(frame: InkFrame): boolean {
    if (this.lost) return false;
    const gl = this.gl;
    const index = this.activeComposite === 0 ? 1 : 0;
    const target = this.ensureComposite(index);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    const ok = this.render(frame);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) return false;
    target.scrollX = window.scrollX;
    target.scrollY = window.scrollY;
    this.activeComposite = index;
    return true;
  }

  draw(frame: InkFrame): void {
    if (this.lost) return;
    this.render(frame);
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('createTexture failed');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private ensureComposite(index: number): CompositeTexture {
    const gl = this.gl;
    const { width, height } = this.canvas;
    let c = this.composites[index];
    if (!c) {
      const framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('createFramebuffer failed');
      c = { texture: this.createTexture(), framebuffer, width: 0, height: 0, scrollX: 0, scrollY: 0 };
      this.composites[index] = c;
    }
    if (c.width !== width || c.height !== height) {
      gl.bindTexture(gl.TEXTURE_2D, c.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, c.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, c.texture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      c.width = width;
      c.height = height;
    }
    return c;
  }

  private sampler(source: InkSource): Sampler | null {
    if (source === 'composite') {
      const c = this.composites[this.activeComposite];
      if (!c) return null;
      return {
        texture: c.texture,
        width: c.width,
        height: c.height,
        ratio: 1,
        offsetX: 0,
        offsetY: 0,
        flipY: true,
      };
    }
    const t = this.textures.get(source);
    if (!t) return null;

    return {
      texture: t.texture,
      width: t.width,
      height: t.height,
      ratio: t.scale / this.canvasScale,
      offsetX: 0,
      offsetY: 0,
      flipY: false,
    };
  }

  private render(frame: InkFrame): boolean {
    const from = this.sampler(frame.from);
    const to = this.sampler(frame.to);
    if (!from || !to) return false;

    const gl = this.gl;
    const { program, uniform } = this.program;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, to.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.noise);

    gl.uniform1i(uniform('uFrom'), 0);
    gl.uniform1i(uniform('uTo'), 1);
    gl.uniform1i(uniform('uNoise'), 2);
    gl.uniform2f(uniform('uFromSize'), from.width, from.height);
    gl.uniform2f(uniform('uToSize'), to.width, to.height);
    gl.uniform4f(uniform('uFromMap'), from.ratio, from.offsetX, from.offsetY, from.flipY ? 1 : 0);
    gl.uniform4f(uniform('uToMap'), to.ratio, to.offsetX, to.offsetY, to.flipY ? 1 : 0);
    gl.uniform1f(uniform('uCanvasScale'), this.canvasScale);
    gl.uniform2f(uniform('uRes'), this.canvas.width, this.canvas.height);
    gl.uniform2f(uniform('uCenter'), frame.center.x, frame.center.y);
    gl.uniform1f(uniform('uRadius'), frame.radius);
    gl.uniform1f(uniform('uCleanup'), frame.cleanup);
    gl.uniform1f(uniform('uTime'), frame.time);
    gl.uniform1f(uniform('uRef'), Math.max(this.canvas.width, this.canvas.height) / this.canvasScale);
    gl.uniform2f(uniform('uSeed'), frame.seed.x, frame.seed.y);
    const cos = Math.cos(frame.seed.angle);
    const sin = Math.sin(frame.seed.angle);
    gl.uniformMatrix2fv(uniform('uSeedRot'), false, [cos, sin, -sin, cos]);

    gl.uniform1f(uniform('uTendril'), inkParams.tendril);
    gl.uniform1f(uniform('uNoiseScale'), inkParams.noiseScale);
    gl.uniform1f(uniform('uSoftness'), inkParams.softness);
    gl.uniform1f(uniform('uDrift'), inkParams.drift);
    gl.uniform3fv(uniform('uRimColor'), getRimColor(frame.to, inkParams.preset));

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
}
