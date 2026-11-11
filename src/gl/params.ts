import type { Theme } from '../ui/theme';

export type PresetName = 'ink' | 'watercolor' | 'smoke' | 'ember' | 'ripple';
export type CaptureMode = 'viewport' | 'full';

/** Live-tunable look of the ink and transition engine. */
export interface InkParams {
  /** Seconds for the spread (before the fade-out). */
  duration: number;
  /** Tendril reach multiplier, 0 = clean blob. */
  tendril: number;
  /** Noise frequency multiplier: lower = bigger, lazier shapes. */
  noiseScale: number;
  /** Frontier half-width in CSS px. */
  softness: number;
  /** Speed at which the shape evolves during the spread. */
  drift: number;
  /** Global playback rate (0.25 for slow motion). */
  timeScale: number;
  /** Active transition preset name. */
  preset: PresetName;
  /** Capture mode: 'viewport' (fast, memory-efficient) or 'full' (full-page snapshot). */
  captureMode: CaptureMode;
}

export interface PresetDef {
  name: string;
  description: string;
  params: Omit<InkParams, 'timeScale' | 'preset' | 'captureMode'>;
  rimColor: Record<Theme, [number, number, number]>;
}

export const PRESET_CONFIGS: Record<PresetName, PresetDef> = {
  ink: {
    name: 'Ink',
    description: 'Classic rich ink bleeding through porous paper with organic filaments and speckles.',
    params: {
      duration: 1.4,
      tendril: 1.0,
      noiseScale: 1.0,
      softness: 1.4,
      drift: 1.0,
    },
    rimColor: {
      dark: [0.0, 0.0, 0.01],
      light: [1.0, 0.996, 0.985],
    },
  },
  watercolor: {
    name: 'Watercolor',
    description: 'Soft translucent pigment diffusion with gentle bleeding and soft gradient edges.',
    params: {
      duration: 1.7,
      tendril: 0.15,
      noiseScale: 0.7,
      softness: 4.8,
      drift: 0.6,
    },
    rimColor: {
      dark: [0.12, 0.18, 0.32],
      light: [0.93, 0.91, 0.85],
    },
  },
  smoke: {
    name: 'Smoke',
    description: 'Turbulent boiling vapor with curling wisps and high drift velocity.',
    params: {
      duration: 1.9,
      tendril: 1.85,
      noiseScale: 1.5,
      softness: 5.5,
      drift: 2.6,
    },
    rimColor: {
      dark: [0.2, 0.2, 0.24],
      light: [0.82, 0.84, 0.88],
    },
  },
  ember: {
    name: 'Ember',
    params: {
      duration: 1.25,
      tendril: 0.65,
      noiseScale: 2.1,
      softness: 0.9,
      drift: 1.8,
    },
    description: 'Fiery glowing paper burn with vivid ember rim coloring and crackling contours.',
    rimColor: {
      dark: [1.0, 0.38, 0.05], // intense ember flame orange
      light: [1.0, 0.72, 0.2],  // hot golden flare
    },
  },
  ripple: {
    name: 'Ripple',
    description: 'Smooth cohesive circular fluid wave with minimal tendril noise.',
    params: {
      duration: 1.05,
      tendril: 0.0,
      noiseScale: 0.45,
      softness: 2.0,
      drift: 0.2,
    },
    rimColor: {
      dark: [0.05, 0.32, 0.55], // deep oceanic cyan
      light: [0.72, 0.9, 1.0],   // bright aqua wave
    },
  },
};

export const inkParams: InkParams = {
  duration: PRESET_CONFIGS.ink.params.duration,
  tendril: PRESET_CONFIGS.ink.params.tendril,
  noiseScale: PRESET_CONFIGS.ink.params.noiseScale,
  softness: PRESET_CONFIGS.ink.params.softness,
  drift: PRESET_CONFIGS.ink.params.drift,
  timeScale: 1,
  preset: 'ink',
  captureMode: 'viewport',
};

/** Apply a preset to live inkParams. */
export function applyPreset(name: PresetName): void {
  const def = PRESET_CONFIGS[name];
  if (!def) return;
  inkParams.preset = name;
  Object.assign(inkParams, def.params);
}

/** Dynamic pigment color pooled at the frontier based on active preset and theme. */
export function getRimColor(theme: Theme, presetName: PresetName = inkParams.preset): [number, number, number] {
  const preset = PRESET_CONFIGS[presetName] || PRESET_CONFIGS.ink;
  return preset.rimColor[theme] || PRESET_CONFIGS.ink.rimColor[theme];
}
