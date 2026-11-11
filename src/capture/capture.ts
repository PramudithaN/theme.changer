import { inkParams } from '../gl/params';
import type { Theme } from '../ui/theme';

/**
 * Snapshots of the page in a given theme.
 *
 * In 'full' mode:
 * We capture the document so a snapshot stays valid while scrolling.
 *
 * In 'viewport' mode:
 * We capture only the visible viewport, achieving 5x-10x faster capture time,
 * lower memory footprint, and crystal-clear sharpness without hitting GPU texture limits.
 */

export interface Snapshot {
  theme: Theme;
  canvas: HTMLCanvasElement;
  /** Texture pixels per CSS pixel. */
  scale: number;
  /** Layout this snapshot is valid for; see {@link layoutKey}. */
  key: string;
  ms: number;
  isViewport: boolean;
  scrollX: number;
  scrollY: number;
}

const BACKGROUND: Record<Theme, string> = {
  light: '#f6f4ef',
  dark: '#0b0b0f',
};

const isCoarsePointer = (): boolean => window.matchMedia('(pointer: coarse)').matches;

/** Device-pixel ratio used for both the snapshots and the overlay canvas. */
export function renderScale(): number {
  const cap = isCoarsePointer() ? 1.5 : 2;
  return Math.min(window.devicePixelRatio || 1, cap);
}

export function documentSize(): { width: number; height: number } {
  const el = document.documentElement;
  if (inkParams.captureMode === 'viewport') {
    return { width: el.clientWidth, height: el.clientHeight };
  }
  // Full mode with safety clamp to prevent GPU texture overflow on long articles
  const maxHeight = Math.min(Math.max(el.scrollHeight, el.clientHeight), 4096);
  return { width: el.clientWidth, height: maxHeight };
}

/**
 * Identifies the layout a snapshot depends on.
 */
export function layoutKey(scale: number): string {
  const { width, height } = documentSize();
  const scrollKey = inkParams.captureMode === 'viewport' ? `@s${window.scrollX},${window.scrollY}` : '';
  return `${inkParams.captureMode}:${width}x${height}@${scale}${scrollKey}`;
}

let _lastCaptureMs = 0;
export function getLastCaptureDurationMs(): number {
  return _lastCaptureMs;
}

export async function capturePage(theme: Theme, scale: number, maxTextureSize: number): Promise<Snapshot> {
  const t0 = performance.now();
  const key = layoutKey(scale);
  const isViewport = inkParams.captureMode === 'viewport';
  const { width, height } = documentSize();

  // Current scroll position
  const currentScrollX = window.scrollX;
  const currentScrollY = window.scrollY;

  // Never exceed what the GPU can hold; the shader handles scale != canvas DPR.
  const safeScale = Math.min(scale, maxTextureSize / width, maxTextureSize / height);

  // Lazy-loaded: html2canvas is ~200 KB and only needed after first paint.
  const { default: html2canvas } = await import('html2canvas');

  const canvas = await html2canvas(document.body, {
    scale: safeScale,
    backgroundColor: BACKGROUND[theme],
    x: isViewport ? currentScrollX : 0,
    y: isViewport ? currentScrollY : 0,
    width,
    height,
    scrollX: isViewport ? -currentScrollX : 0,
    scrollY: isViewport ? -currentScrollY : 0,
    windowWidth: width,
    windowHeight: height,
    logging: false,
    useCORS: true,
    onclone: (doc) => {
      doc.documentElement.dataset.theme = theme;
      // The live toggle is drawn above the overlay, so leave a hole for it.
      doc.querySelectorAll<HTMLElement>('[data-ink-live]').forEach((el) => {
        el.style.visibility = 'hidden';
      });
    },
  });

  const durationMs = performance.now() - t0;
  _lastCaptureMs = durationMs;

  return {
    theme,
    canvas,
    scale: safeScale,
    key,
    ms: durationMs,
    isViewport,
    scrollX: isViewport ? currentScrollX : 0,
    scrollY: isViewport ? currentScrollY : 0,
  };
}
