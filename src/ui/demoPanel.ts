import { applyPreset, inkParams, PRESET_CONFIGS, type CaptureMode, type InkParams, type PresetName } from '../gl/params';
import type { InkTransition } from './inkTransition';
import './demoPanel.css';

type SliderKey = 'duration' | 'tendril' | 'noiseScale' | 'softness' | 'drift';

interface SliderDef {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const SLIDERS: SliderDef[] = [
  { key: 'duration', label: 'Duration', min: 0.4, max: 4, step: 0.05, format: (v) => `${v.toFixed(2)}s` },
  { key: 'tendril', label: 'Tendrils', min: 0, max: 2.5, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'noiseScale', label: 'Noise scale', min: 0.3, max: 3.0, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'softness', label: 'Softness', min: 0.5, max: 10, step: 0.1, format: (v) => `${v.toFixed(1)}px` },
  { key: 'drift', label: 'Drift', min: 0, max: 4, step: 0.05, format: (v) => v.toFixed(2) },
];

const PRESET_KEYS: PresetName[] = ['ink', 'watercolor', 'smoke', 'ember', 'ripple'];

const STORAGE_KEY = 'ink-bleed:params:v3';
const SLOW_MO = 0.25;

export interface PanelOptions {
  showMarker: boolean;
  onMarkerChange: (show: boolean) => void;
}

/** Applies persisted settings to `inkParams`. Call before the first transition. */
export function loadSettings(): { showMarker: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { showMarker: true };
    const saved = JSON.parse(raw) as Partial<InkParams> & { showMarker?: boolean };

    if (saved.preset && saved.preset in PRESET_CONFIGS) {
      applyPreset(saved.preset as PresetName);
    }
    if (saved.captureMode === 'viewport' || saved.captureMode === 'full') {
      inkParams.captureMode = saved.captureMode;
    }

    for (const s of SLIDERS) {
      const v = saved[s.key];
      if (typeof v === 'number' && Number.isFinite(v)) inkParams[s.key] = clamp(v, s.min, s.max);
    }
    if (saved.timeScale === SLOW_MO) inkParams.timeScale = SLOW_MO;
    return { showMarker: saved.showMarker !== false };
  } catch {
    return { showMarker: true };
  }
}

export class DemoPanel {
  readonly el: HTMLElement;
  private readonly ink: InkTransition;
  private readonly opts: PanelOptions;
  private readonly replayButton: HTMLButtonElement;
  private readonly perfTag: HTMLElement;
  private showMarker: boolean;

  constructor(ink: InkTransition, opts: PanelOptions) {
    this.ink = ink;
    this.opts = opts;
    this.showMarker = opts.showMarker;

    const el = document.createElement('aside');
    el.className = 'demo-panel';
    el.hidden = true;
    el.setAttribute('aria-label', 'Transition Inspector');
    el.setAttribute('data-html2canvas-ignore', '');
    el.innerHTML = `
      <header class="demo-panel__head">
        <div class="demo-panel__title-group">
          <span class="demo-panel__status-dot ${ink.isWebGL ? '' : 'is-fallback'}"></span>
          <span class="demo-panel__title">Transition</span>
        </div>
        <div class="demo-panel__meta">
          <span class="demo-panel__tag demo-panel__perf">Ready</span>
          <span class="demo-panel__tag">${ink.isWebGL ? 'WebGL2' : 'CSS'}</span>
          <button type="button" class="demo-panel__close" title="Close inspector (D)" aria-label="Close inspector">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      </header>

      <div class="demo-panel__segmented" role="tablist" aria-label="Presets"></div>

      <div class="demo-panel__subbar">
        <div class="demo-panel__pill-switch" role="group" aria-label="Capture strategy">
          <button type="button" class="demo-panel__pill-btn" data-mode="viewport">Viewport</button>
          <button type="button" class="demo-panel__pill-btn" data-mode="full">Full</button>
        </div>
        <div class="demo-panel__toggles">
          <label class="demo-panel__toggle-label" title="Slow down animation to 0.25x speed">
            <input type="checkbox" data-slowmo /> 0.25×
          </label>
          <label class="demo-panel__toggle-label" title="Show visual click indicator in auto mode">
            <input type="checkbox" data-marker /> Marker
          </label>
        </div>
      </div>

      <div class="demo-panel__sliders"></div>

      <div class="demo-panel__actions">
        <button type="button" class="demo-panel__btn-replay" data-replay disabled>
          Replay <kbd>R</kbd>
        </button>
        <button type="button" class="demo-panel__btn-reset" data-reset>Reset</button>
      </div>
      <p class="demo-panel__keys"><kbd>D</kbd> close · <kbd>T</kbd> toggle · <kbd>R</kbd> replay</p>
    `;

    // Close button
    el.querySelector('.demo-panel__close')?.addEventListener('click', () => this.toggle());

    // Presets Segmented Bar
    const segmented = el.querySelector<HTMLElement>('.demo-panel__segmented');
    for (const key of PRESET_KEYS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `demo-panel__seg-btn ${inkParams.preset === key ? 'is-active' : ''}`;
      btn.dataset.preset = key;
      btn.textContent = PRESET_CONFIGS[key].name;
      btn.title = PRESET_CONFIGS[key].description;
      btn.addEventListener('click', () => this.selectPreset(key));
      segmented?.append(btn);
    }

    // Capture Mode Switch
    const modeBtns = el.querySelectorAll<HTMLButtonElement>('.demo-panel__pill-btn');
    modeBtns.forEach((btn) => {
      if (btn.dataset.mode === inkParams.captureMode) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as CaptureMode;
        if (!mode) return;
        inkParams.captureMode = mode;
        this.ink.setCaptureMode(mode);
        modeBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
        this.updatePerfTag();
        this.save();
      });
    });

    // Sliders
    const sliders = el.querySelector<HTMLElement>('.demo-panel__sliders');
    for (const s of SLIDERS) sliders?.append(this.createSlider(s));

    // Slow motion
    const slowmo = el.querySelector<HTMLInputElement>('[data-slowmo]');
    if (slowmo) {
      slowmo.checked = inkParams.timeScale === SLOW_MO;
      slowmo.addEventListener('change', () => {
        this.ink.setTimeScale(slowmo.checked ? SLOW_MO : 1);
        this.save();
      });
    }

    // Tap marker
    const marker = el.querySelector<HTMLInputElement>('[data-marker]');
    if (marker) {
      marker.checked = this.showMarker;
      marker.addEventListener('change', () => {
        this.showMarker = marker.checked;
        this.opts.onMarkerChange(marker.checked);
        this.save();
      });
    }

    // Actions
    const replay = el.querySelector<HTMLButtonElement>('[data-replay]');
    if (!replay) throw new Error('demo panel replay markup');
    this.replayButton = replay;
    replay.addEventListener('click', () => this.replay());

    el.querySelector('[data-reset]')?.addEventListener('click', () => this.reset());

    const perf = el.querySelector<HTMLElement>('.demo-panel__perf');
    if (!perf) throw new Error('perf tag markup');
    this.perfTag = perf;

    document.body.append(el);
    this.el = el;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
    if (this.isOpen) this.refresh();
  }

  replay(): void {
    this.ink.replay();
  }

  selectPreset(key: PresetName): void {
    applyPreset(key);
    this.syncSliderInputs();

    const buttons = this.el.querySelectorAll<HTMLButtonElement>('.demo-panel__seg-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.preset === key);
    });

    this.save();
  }

  refresh(): void {
    this.replayButton.disabled = this.ink.lastClick === null;
    this.updatePerfTag();
  }

  private updatePerfTag(): void {
    const ms = this.ink.getLastCaptureDuration();
    if (ms > 0) {
      this.perfTag.textContent = `${ms.toFixed(0)}ms`;
    } else {
      this.perfTag.textContent = 'Ready';
    }
  }

  private createSlider(def: SliderDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'demo-panel__slider-row';
    row.innerHTML = `
      <div class="demo-panel__slider-head">
        <span class="demo-panel__slider-name">${def.label}</span>
        <span class="demo-panel__slider-val"></span>
      </div>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" />
    `;
    const input = row.querySelector('input');
    const val = row.querySelector<HTMLElement>('.demo-panel__slider-val');
    if (!input || !val) return row;
    input.dataset.key = def.key;
    input.value = String(inkParams[def.key]);
    val.textContent = def.format(inkParams[def.key]);

    input.addEventListener('input', () => {
      const v = Number(input.value);
      inkParams[def.key] = v;
      val.textContent = def.format(v);
      this.save();
    });
    return row;
  }

  private syncSliderInputs(): void {
    for (const s of SLIDERS) {
      const input = this.el.querySelector<HTMLInputElement>(`input[data-key="${s.key}"]`);
      const val = input?.parentElement?.querySelector<HTMLElement>('.demo-panel__slider-val');
      if (input) input.value = String(inkParams[s.key]);
      if (val) val.textContent = s.format(inkParams[s.key]);
    }
  }

  private reset(): void {
    this.selectPreset('ink');
    inkParams.captureMode = 'viewport';

    const modeBtns = this.el.querySelectorAll<HTMLButtonElement>('.demo-panel__pill-btn');
    modeBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.mode === 'viewport'));
    this.ink.setCaptureMode('viewport');

    const slowmo = this.el.querySelector<HTMLInputElement>('[data-slowmo]');
    if (slowmo) slowmo.checked = false;
    this.ink.setTimeScale(1);
    this.save();
  }

  private save(): void {
    try {
      const data: Record<string, unknown> = {
        timeScale: inkParams.timeScale,
        showMarker: this.showMarker,
        preset: inkParams.preset,
        captureMode: inkParams.captureMode,
      };
      for (const s of SLIDERS) data[s.key] = inkParams[s.key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable in private browsing */
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
