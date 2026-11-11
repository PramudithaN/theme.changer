import gsap from 'gsap';
import { capturePage, layoutKey, renderScale } from '../capture/capture';
import { applyPreset, inkParams, type CaptureMode, type PresetName } from '../gl/params';
import { InkRenderer, type InkFrame, type InkSource } from '../gl/renderer';
import { applyTheme, getTheme, otherTheme, type Theme } from './theme';
import { ThemeIcon } from './themeIcon';

export interface Point {
  x: number;
  y: number;
}

const EASE = 'power3.out';
const FADE_OUT = 0.15;
const RESIZE_DEBOUNCE_MS = 250;
/** CSS cross-fade used without WebGL2, with reduced motion, or before snapshots are ready. */
const CSS_FADE_S = 0.45;

/**
 * Spread shape over time. `growth`: base radius at progress 1 relative to the farthest
 * corner. `cleanupFrom`: fraction of the (linear) duration after which a uniform extra
 * reach slowly eats whatever the noise left behind, so the page is fully covered exactly
 * at the end. `cleanupReach`: that extra reach at t = 1, relative to the farthest corner.
 */
export const SPREAD = { growth: 0.7, cleanupFrom: 0.45, cleanupReach: 0.4, cleanupPow: 2 };

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Everything needed to reproduce a transition exactly ("replay last click"). */
export interface ClickRecord {
  point: Point;
  seed: InkFrame['seed'];
  from: Theme;
}

const REPLAY_HOLD_MS = 400;

type ActiveFrame = Omit<InkFrame, 'progress' | 'radius' | 'time' | 'cleanup'>;

export interface InkTransitionOptions {
  webgl?: boolean;
  captureOnToggle?: boolean;
  onToggle?: (theme: Theme) => void;
}

/**
 * Orchestrates the theme transition:
 *  1. On toggle (default on-demand mode): snapshots the current screen at that millisecond,
 *     displays it on the WebGL canvas, switches the live DOM, and runs the ink shader
 *     spreading over the live page.
 *  2. Background pre-cache mode (when captureOnToggle: false): keeps snapshots of both themes on GPU.
 *  3. Automatically invalidates textures on SPA navigation (popstate).
 *  4. Falls back to CSS colour cross-fade without WebGL2 or with reduced motion.
 */
export class InkTransition {
  private readonly renderer: InkRenderer | null;
  private readonly toggleButton: HTMLButtonElement | null;
  private readonly icon: ThemeIcon | null;
  private readonly state = { progress: 0, time: 0 };
  private tween: gsap.core.Tween | null = null;
  private fade: gsap.core.Tween | null = null;
  private frame: ActiveFrame | null = null;
  private cssFadeTimer = 0;
  private replayTimer = 0;
  private last: ClickRecord | null = null;

  readonly captureOnToggle: boolean;
  private readonly onToggle?: (theme: Theme) => void;
  private lastCaptureMs = 0;

  private captureGen = 0;
  private capturing = false;
  private captureQueued = false;
  private resizeTimer = 0;

  constructor(canvas: HTMLCanvasElement, toggleButton: HTMLButtonElement | null, opts: InkTransitionOptions = {}) {
    this.captureOnToggle = opts.captureOnToggle ?? true;
    this.onToggle = opts.onToggle;
    this.toggleButton = toggleButton;
    this.icon = toggleButton ? new ThemeIcon(toggleButton) : null;
    this.icon?.set(getTheme());

    this.renderer = opts.webgl === false ? null : InkRenderer.create(canvas);
    if (!this.renderer) {
      document.documentElement.dataset.ink = 'css';
      return;
    }
    document.documentElement.dataset.ink = 'webgl';

    this.renderer.resize(renderScale());
    this.renderer.watchContext(
      () => this.cancel(),
      () => {
        if (!this.captureOnToggle) this.scheduleCapture(0);
      },
    );

    // Automatically listen to SPA URL changes (popstate)
    window.addEventListener('popstate', () => this.invalidate());

    if (!this.captureOnToggle) {
      // Kick off pre-capture immediately on mount so snapshots are ready on the very first click
      this.scheduleCapture(0);

      let scrollDebounce = 0;
      window.addEventListener('scroll', () => {
        window.clearTimeout(scrollDebounce);
        scrollDebounce = window.setTimeout(() => {
          this.scheduleCapture(0);
        }, 120);
      }, { passive: true });

      window.addEventListener('resize', () => {
        this.renderer?.resize(renderScale());
        if (this.frame) this.draw();
        this.scheduleCapture(RESIZE_DEBOUNCE_MS);
      });
      // Catches document-height changes that aren't window resizes (late fonts, images).
      new ResizeObserver(() => this.scheduleCapture(RESIZE_DEBOUNCE_MS)).observe(document.body);
      // Snapshots are skipped under reduced motion; take them if the preference is lifted.
      reducedMotion.addEventListener('change', () => this.scheduleCapture(0));

      void document.fonts.ready.then(() => this.scheduleCapture(50));
    } else {
      window.addEventListener('resize', () => {
        this.renderer?.resize(renderScale());
        if (this.frame) this.draw();
      });
    }
  }

  get isWebGL(): boolean {
    return this.renderer !== null;
  }

  get isAnimating(): boolean {
    return this.frame !== null || this.cssFadeTimer !== 0;
  }

  /** The most recent click, for "replay last click". */
  get lastClick(): ClickRecord | null {
    return this.last;
  }

  get activePreset(): PresetName {
    return inkParams.preset;
  }

  get captureMode(): CaptureMode {
    return inkParams.captureMode;
  }

  setPreset(name: PresetName): void {
    applyPreset(name);
  }

  setCaptureMode(mode: CaptureMode): void {
    inkParams.captureMode = mode;
    if (!this.captureOnToggle) {
      this.scheduleCapture(0);
    }
  }

  getLastCaptureDuration(): number {
    return this.lastCaptureMs || (this.renderer?.getLastCaptureMs() ?? 0);
  }

  /**
   * Toggle the theme, spreading from `point` (viewport CSS px) or from the toggle button.
   * `seed` reproduces a previous spread exactly.
   * Also accepts an options object or custom `onToggle` callback.
   */
  async toggle(
    pointOrOpts?: Point | { point?: Point; seed?: InkFrame['seed']; onToggle?: (theme: Theme) => void },
    seed?: InkFrame['seed'],
  ): Promise<void> {
    if (this.isAnimating || this.capturing) return;
    window.clearTimeout(this.replayTimer);

    let point: Point | undefined;
    let frameSeed: InkFrame['seed'] | undefined = seed;
    let customOnToggle: ((theme: Theme) => void) | undefined;

    if (pointOrOpts && ('x' in pointOrOpts || 'y' in pointOrOpts)) {
      point = pointOrOpts as Point;
    } else if (pointOrOpts && typeof pointOrOpts === 'object') {
      point = pointOrOpts.point;
      frameSeed = pointOrOpts.seed ?? seed;
      customOnToggle = pointOrOpts.onToggle;
    }

    const from = getTheme();
    const to = otherTheme(from);
    const renderer = this.renderer;

    if (!renderer || renderer.isLost || reducedMotion.matches) {
      this.cancel();
      this.crossFade(to, customOnToggle);
      return;
    }

    if (this.captureOnToggle) {
      await this.toggleOnDemand(from, to, point, frameSeed, customOnToggle);
      return;
    }

    const scale = renderScale();
    const key = layoutKey(scale);
    const interrupting = this.frame !== null;

    const canAnimate =
      renderer.hasValid(to, key) &&
      (interrupting || renderer.hasValid(from, key));

    if (!canAnimate) {
      void this.captureAndAnimate(to, point, frameSeed, customOnToggle);
      return;
    }

    this.startAnimation(to, point, frameSeed, customOnToggle);
  }

  private async toggleOnDemand(
    from: Theme,
    to: Theme,
    point?: Point,
    seed?: InkFrame['seed'],
    customOnToggle?: (theme: Theme) => void,
  ): Promise<void> {
    const renderer = this.renderer;
    if (!renderer || this.capturing || this.isAnimating) return;

    this.capturing = true;
    document.documentElement.classList.add('is-animating');

    const scale = renderScale();
    const center = point ?? this.toggleCenter();
    const maxDist = farthestCorner(center);
    const frameSeed = seed ?? randomSeed();
    this.last = { point: center, seed: frameSeed, from };

    try {
      // 1. Snapshot the current screen right at that exact millisecond
      const snap = await capturePage(from, scale, renderer.maxTextureSize);
      if (renderer.isLost) {
        this.capturing = false;
        this.crossFade(to, customOnToggle);
        return;
      }
      this.lastCaptureMs = snap.ms;
      renderer.upload(snap);

      // 2. Display the snapshot on the WebGL canvas
      renderer.resize(scale);
      this.frame = { from, to, center, maxDist, seed: frameSeed, live: true };
      this.state.progress = 0;
      this.state.time = 0;
      this.draw();

      gsap.set(renderer.canvas, { opacity: 1 });
      renderer.canvas.classList.add('is-active');

      // 3. Switch the live theme (dataset.theme = nextTheme and run consumer's toggle callback)
      const chromeFrom = this.icon?.readChrome();
      applyTheme(to, this.toggleButton);
      this.onToggle?.(to);
      customOnToggle?.(to);

      const duration = inkParams.duration;
      this.icon?.morphTo(to, {
        duration,
        ease: EASE,
        timeScale: inkParams.timeScale,
        chromeFrom,
        chromeDelay: this.inkArrival(center, maxDist, this.toggleCenter()) * duration,
      });

      // 4. Run the ink shader spreading over the live page!
      this.tween = gsap.to(this.state, {
        progress: 1,
        duration,
        ease: EASE,
        onUpdate: () => {
          this.state.time = this.tween?.time() ?? 0;
          this.draw();
        },
        onComplete: () => this.finish(),
      });
      this.tween.timeScale(inkParams.timeScale);
    } catch (err) {
      console.error('[ink] toggleOnDemand failed, falling back to crossfade', err);
      this.hide();
      this.crossFade(to, customOnToggle);
    } finally {
      this.capturing = false;
    }
  }

  private async captureAndAnimate(
    to: Theme,
    point?: Point,
    seed?: InkFrame['seed'],
    customOnToggle?: (theme: Theme) => void,
  ): Promise<void> {
    if (this.capturing) return;
    try {
      await this.captureAll();
      const renderer = this.renderer;
      const scale = renderScale();
      const key = layoutKey(scale);
      if (renderer && renderer.hasValid(to, key)) {
        this.startAnimation(to, point, seed, customOnToggle);
      } else {
        this.crossFade(to, customOnToggle);
      }
    } catch {
      this.crossFade(to, customOnToggle);
    }
  }

  private startAnimation(
    to: Theme,
    point?: Point,
    seed?: InkFrame['seed'],
    customOnToggle?: (theme: Theme) => void,
  ): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const scale = renderScale();
    const interrupting = this.frame !== null;

    // Interrupted: freeze exactly what is on screen and spread the new ink over it.
    let from: InkSource = getTheme();
    if (interrupting) {
      this.tween?.kill();
      this.fade?.kill();
      this.tween = this.fade = null;
      renderer.resize(scale);
      const frozen = this.currentFrame();
      from = frozen && renderer.freeze(frozen) ? 'composite' : getTheme();
    }

    const center = point ?? this.toggleCenter();
    const maxDist = farthestCorner(center);
    const frameSeed = seed ?? randomSeed();
    this.last = { point: center, seed: frameSeed, from: otherTheme(to) };
    this.frame = { from, to, center, maxDist, seed: frameSeed, live: false };
    this.state.progress = 0;
    this.state.time = 0;

    const chromeFrom = this.icon?.readChrome();
    document.documentElement.classList.add('is-animating');
    renderer.resize(scale);
    this.draw();
    // Same task: the overlay (showing "from") and the flipped DOM hit the screen together.
    gsap.set(renderer.canvas, { opacity: 1 });
    renderer.canvas.classList.add('is-active');
    applyTheme(to, this.toggleButton);
    this.onToggle?.(to);
    customOnToggle?.(to);

    const duration = inkParams.duration;
    this.icon?.morphTo(to, {
      duration,
      ease: EASE,
      timeScale: inkParams.timeScale,
      chromeFrom,
      chromeDelay: this.inkArrival(center, maxDist, this.toggleCenter()) * duration,
    });

    this.tween = gsap.to(this.state, {
      progress: 1,
      duration,
      ease: EASE,
      onUpdate: () => {
        // Tween-local seconds: slow motion slows the drift too, so it looks identical.
        this.state.time = this.tween?.time() ?? 0;
        this.draw();
      },
      onComplete: () => this.finish(),
    });
    this.tween.timeScale(inkParams.timeScale);
  }

  /**
   * Re-run the last click: snap back to the theme it started from, hold briefly (a clean
   * first frame for the recording), then spread again with the same point and seed.
   */
  replay(): boolean {
    if (this.isAnimating) return false;
    const last = this.last;
    if (!last) return false;
    window.clearTimeout(this.replayTimer);
    this.cancel();
    this.icon?.kill();
    if (getTheme() !== last.from) {
      applyTheme(last.from, this.toggleButton);
      this.icon?.set(last.from);
    }
    this.replayTimer = window.setTimeout(() => this.toggle(last.point, last.seed), REPLAY_HOLD_MS);
    return true;
  }

  /** Live playback rate (slow motion), applied to a running transition too. */
  setTimeScale(scale: number): void {
    inkParams.timeScale = scale;
    this.tween?.timeScale(scale);
    this.fade?.timeScale(scale);
    this.icon?.setTimeScale(scale);
  }

  private currentFrame(): InkFrame | null {
    if (!this.frame) return null;
    const { progress, time } = this.state;
    const { maxDist } = this.frame;
    const linear = Math.min(1, time / inkParams.duration);
    const ramp = Math.max(0, (linear - SPREAD.cleanupFrom) / (1 - SPREAD.cleanupFrom));
    // Second term only acts in the last ~3% (≈40ms): a guarantee for unlucky seeds so the
    // final frame is exactly the "to" snapshot before the fade (measured residual is 0).
    const cleanup =
      ramp ** SPREAD.cleanupPow * maxDist * SPREAD.cleanupReach + Math.max(0, (linear - 0.97) / 0.03) * maxDist;
    return { ...this.frame, progress, time, radius: progress * maxDist * SPREAD.growth, cleanup };
  }

  private draw(): void {
    const frame = this.currentFrame();
    if (this.renderer && frame) this.renderer.draw(frame);
  }

  private finish(): void {
    const canvas = this.renderer?.canvas;
    this.tween = null;
    if (!canvas) return;
    this.fade = gsap
      .to(canvas, { opacity: 0, duration: FADE_OUT, ease: 'none', onComplete: () => this.hide() })
      .timeScale(inkParams.timeScale);
  }

  private hide(): void {
    this.fade = null;
    this.frame = null;
    this.renderer?.canvas.classList.remove('is-active');
    document.documentElement.classList.remove('is-animating');
    if (!this.captureOnToggle && this.captureQueued) this.scheduleCapture(0);
  }

  private cancel(): void {
    if (!this.frame && !this.capturing) return;
    this.tween?.kill();
    this.fade?.kill();
    this.tween = null;
    document.documentElement.classList.remove('is-animating');
    this.hide();
  }

  /** Plain CSS colour transition fallback without jumping or flashing. */
  private crossFade(to: Theme, customOnToggle?: (theme: Theme) => void): void {
    const motion = !reducedMotion.matches;
    const root = document.documentElement;

    root.classList.add('theme-fade');
    root.classList.add('is-animating');
    root.style.setProperty('--theme-fade', `${CSS_FADE_S}s`);
    applyTheme(to, this.toggleButton);
    this.onToggle?.(to);
    customOnToggle?.(to);

    if (motion) {
      this.icon?.morphTo(to, { duration: CSS_FADE_S * 1.6, ease: 'power2.inOut', timeScale: 1 });
    } else {
      this.icon?.set(to);
    }

    window.clearTimeout(this.cssFadeTimer);
    this.cssFadeTimer = window.setTimeout(() => {
      root.classList.remove('theme-fade');
      root.classList.remove('is-animating');
      this.cssFadeTimer = 0;
      if (!this.captureOnToggle && this.captureQueued) this.scheduleCapture(0);
    }, CSS_FADE_S * 1000 + 50);
  }

  /**
   * Fraction of the duration at which the base ink front reaches `target` (the eased
   * radius inverted; slightly early, since the noise lets the front lead).
   */
  private inkArrival(center: Point, maxDist: number, target: Point): number {
    const dist = Math.hypot(target.x - center.x, target.y - center.y);
    if (dist < 28) return 0;
    const p = Math.min(1, dist / (maxDist * SPREAD.growth * 1.15));
    // Inverse of power3.out, capped: the end-of-spread cleanup sweeps the last corners by ~85%.
    return Math.min(0.85, 1 - Math.cbrt(1 - p));
  }

  private toggleCenter(): Point {
    const r = this.toggleButton?.getBoundingClientRect();
    if (!r) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private forceCapture = false;

  // ---------- Capture scheduling ----------

  /** Invalidate cached snapshots and re-capture them in the background (if pre-caching is enabled). */
  public invalidate(delay: number = 0): void {
    this.renderer?.clearTextures();
    this.forceCapture = true;
    if (!this.captureOnToggle) {
      this.scheduleCapture(delay);
    }
  }

  public scheduleCapture(delay: number = 0): void {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => void this.captureAll(), delay);
  }

  private async captureAll(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer || renderer.isLost || reducedMotion.matches) return;

    // Capturing blocks the main thread; never do it mid-animation (or mid CSS fade, which
    // would bake half-transitioned colours into the snapshot).
    if (this.capturing || this.frame || document.documentElement.classList.contains('theme-fade')) {
      this.captureQueued = true;
      return;
    }

    const scale = renderScale();
    const key = layoutKey(scale);
    const current = getTheme();
    const force = this.forceCapture;
    this.forceCapture = false;
    const themes: Theme[] = force
      ? [current, otherTheme(current)]
      : [current, otherTheme(current)].filter((t) => !renderer.hasValid(t, key));
    this.captureQueued = false;
    if (themes.length === 0) return;

    const gen = ++this.captureGen;
    this.capturing = true;
    try {
      for (const theme of themes) {
        const snap = await capturePage(theme, scale, renderer.maxTextureSize);
        if (gen !== this.captureGen) return;
        renderer.upload(snap);
        if (import.meta.env.DEV) {
          console.debug(
            `[ink] captured ${theme} ${snap.canvas.width}×${snap.canvas.height} in ${snap.ms.toFixed(0)}ms`,
          );
        }
      }
    } catch (err) {
      console.error('[ink] capture failed', err);
    } finally {
      this.capturing = false;
    }
    if (this.captureQueued) this.scheduleCapture(RESIZE_DEBOUNCE_MS);
  }
}

function farthestCorner(p: Point): number {
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  return Math.max(Math.hypot(p.x, p.y), Math.hypot(w - p.x, p.y), Math.hypot(p.x, h - p.y), Math.hypot(w - p.x, h - p.y)) + 4;
}

function randomSeed(): InkFrame['seed'] {
  return { x: Math.random() * 64 - 32, y: Math.random() * 64 - 32, angle: Math.random() * Math.PI * 2 };
}
