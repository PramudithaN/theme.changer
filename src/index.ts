import { applyPreset, inkParams, PRESET_CONFIGS, type CaptureMode, type InkParams, type PresetName } from './gl/params';
import { InkRenderer, type InkFrame, type InkSource } from './gl/renderer';
import { InkTransition, type ClickRecord, type InkTransitionOptions, type Point } from './ui/inkTransition';
import { applyTheme, getTheme, otherTheme, type Theme } from './ui/theme';

export interface CreateInkTransitionOptions {
  /** Optional theme toggle button element. */
  toggleButton?: HTMLButtonElement | null;
  /** Force WebGL (true) or CSS/ViewTransition fallback (false). Default: auto-detect */
  webgl?: boolean;
  /** Transition preset to apply. Default: 'ink' */
  preset?: PresetName;
  /** Capture mode strategy: 'viewport' (fast, recommended) or 'full'. Default: 'viewport' */
  captureMode?: CaptureMode;
  /**
   * Whether to capture snapshot on demand when toggle() is called (true)
   * or pre-cache both themes in advance in the background (false).
   * Default: true
   */
  captureOnToggle?: boolean;
  /**
   * Callback fired immediately when theme toggles, allowing frameworks
   * (React, Vue, Svelte) to synchronize their state and re-render.
   */
  onToggle?: (theme: Theme) => void;
}

/**
 * Convenience helper to create and mount an InkTransition instance in any web application.
 *
 * @example
 * ```ts
 * import { createInkTransition } from '@pramuditha/theme.changer';
 *
 * const ink = createInkTransition({
 *   toggleButton: document.querySelector('#theme-toggle'),
 *   preset: 'ember',
 *   captureOnToggle: true,
 *   onToggle: (theme) => console.log('Switched to', theme),
 * });
 * ```
 */
export function createInkTransition(options: CreateInkTransitionOptions = {}): InkTransition {
  if (options.preset) {
    applyPreset(options.preset);
  }
  if (options.captureMode) {
    inkParams.captureMode = options.captureMode;
  }

  // Create overlay canvas if one does not exist
  let canvas = document.querySelector<HTMLCanvasElement>('canvas.ink-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'ink-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-html2canvas-ignore', '');
    document.body.append(canvas);
  }

  const toggle = options.toggleButton ?? document.querySelector<HTMLButtonElement>('#theme-toggle');
  return new InkTransition(canvas, toggle, {
    webgl: options.webgl,
    captureOnToggle: options.captureOnToggle,
    onToggle: options.onToggle,
  });
}

export {
  InkTransition,
  InkRenderer,
  applyPreset,
  inkParams,
  PRESET_CONFIGS,
  applyTheme,
  getTheme,
  otherTheme,
};

export type {
  PresetName,
  CaptureMode,
  InkParams,
  InkFrame,
  InkSource,
  InkTransitionOptions,
  ClickRecord,
  Point,
  Theme,
};
