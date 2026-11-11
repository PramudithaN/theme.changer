import gsap from 'gsap';
import { type PresetName } from './gl/params';
import { mountPage } from './page/mount';
import { startAutoMode } from './ui/autoMode';
import { DemoPanel, loadSettings } from './ui/demoPanel';
import { InkTransition, SPREAD } from './ui/inkTransition';
import { applyTheme, getTheme } from './ui/theme';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root missing');

mountPage(app);

const toggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
applyTheme(getTheme(), toggle);

const canvas = document.createElement('canvas');
canvas.className = 'ink-canvas';
canvas.setAttribute('aria-hidden', 'true');
canvas.setAttribute('data-html2canvas-ignore', '');
document.body.append(canvas);

const params = new URLSearchParams(location.search);
const settings = loadSettings();

// ?gl=0 forces the CSS fallback (what browsers without WebGL2 get).
const ink = new InkTransition(canvas, toggle, { webgl: params.get('gl') !== '0' });

let showMarker = settings.showMarker;
const panel = new DemoPanel(ink, {
  showMarker,
  onMarkerChange: (show) => {
    showMarker = show;
  },
});

toggle?.addEventListener('click', (e) => {
  // detail === 0 means a keyboard-activated click (Enter/Space): spread from the button.
  ink.toggle(e.detail === 0 ? undefined : { x: e.clientX, y: e.clientY });
  panel.refresh();
});

// Primary CTA toggle buttons
document.querySelectorAll<HTMLElement>('[data-trigger-toggle]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    ink.toggle({ x: e.clientX, y: e.clientY });
    panel.refresh();
  });
});

// Panel open trigger
document.querySelectorAll<HTMLElement>('[data-trigger-panel]').forEach((btn) => {
  btn.addEventListener('click', () => {
    panel.toggle();
  });
});

// Interactive Playground Stage
const stageCanvas = document.querySelector<HTMLElement>('[data-interactive-stage]');
const stageReticle = document.querySelector<HTMLElement>('#stage-reticle');
const hudCoords = document.querySelector<HTMLElement>('#hud-coords');
const specShader = document.querySelector<HTMLElement>('#spec-shader');

const SHADER_DESCS: Record<PresetName, string> = {
  ink: 'Simplex FBM + Curl Noise',
  watercolor: 'Dual-Octave Domain Warping',
  smoke: 'Turbulent Advection + Dissipation',
  ember: 'High-Frequency Threshold Dissolve',
  ripple: 'Circular Wavefront SDF',
};

if (stageCanvas) {
  stageCanvas.addEventListener('click', (e) => {
    const rect = stageCanvas.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    if (stageReticle) {
      stageReticle.style.left = `${relX}px`;
      stageReticle.style.top = `${relY}px`;
      stageReticle.classList.remove('is-active');
      void stageReticle.offsetWidth;
      stageReticle.classList.add('is-active');
    }

    if (hudCoords) {
      hudCoords.textContent = `X: ${Math.round(e.clientX)} Y: ${Math.round(e.clientY)}`;
    }

    ink.toggle({ x: e.clientX, y: e.clientY });
    panel.refresh();
  });
}

// Shader Preset Tabs in Playground
const shaderTabs = document.querySelectorAll<HTMLButtonElement>('[data-select-preset]');
shaderTabs.forEach((tab) => {
  tab.addEventListener('click', (e) => {
    const preset = tab.dataset.selectPreset as PresetName;
    if (!preset) return;

    shaderTabs.forEach((t) => t.classList.toggle('is-active', t === tab));
    panel.selectPreset(preset);

    if (specShader && SHADER_DESCS[preset]) {
      specShader.textContent = SHADER_DESCS[preset];
    }

    ink.toggle({ x: e.clientX, y: e.clientY });
    panel.refresh();
  });
});

// Framework Integration Code Tabs
const snippetTabs = document.querySelectorAll<HTMLButtonElement>('.snippet-tab');
const snippetCodes = document.querySelectorAll<HTMLElement>('.snippet-code');

snippetTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const lang = tab.dataset.lang;
    if (!lang) return;

    snippetTabs.forEach((t) => t.classList.toggle('is-active', t === tab));
    snippetCodes.forEach((code) => {
      code.classList.toggle('is-hidden', code.dataset.code !== lang);
    });
  });
});

// Package manager command switcher
const PKG_COMMANDS: Record<string, string> = {
  npm: 'npm install theme.changer gsap html2canvas',
  pnpm: 'pnpm add theme.changer gsap html2canvas',
  yarn: 'yarn add theme.changer gsap html2canvas',
  bun: 'bun add theme.changer gsap html2canvas',
};

const pkgTabs = document.querySelectorAll<HTMLButtonElement>('.cli-tab');
const pkgCmdDisplay = document.querySelector<HTMLElement>('#pkg-cmd-display');
const pkgCopyBtn = document.querySelector<HTMLButtonElement>('#pkg-copy-btn');

pkgTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const pkg = tab.dataset.pkg;
    if (pkg && pkg in PKG_COMMANDS && pkgCmdDisplay) {
      pkgTabs.forEach((t) => t.classList.toggle('is-active', t === tab));
      pkgCmdDisplay.textContent = PKG_COMMANDS[pkg] || '';
    }
  });
});

// Clipboard copy utility
function setupCopy(btn: HTMLElement | null, textGetter: () => string) {
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(textGetter());
      btn.classList.add('is-copied');
      const feedback = btn.querySelector<HTMLElement>('.copy-feedback') || btn;
      const originalText = feedback.textContent || 'Copy';
      feedback.textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('is-copied');
        feedback.textContent = originalText;
      }, 2000);
    } catch {
      /* clipboard write denied */
    }
  });
}

setupCopy(pkgCopyBtn, () => pkgCmdDisplay?.textContent || 'npm install theme.changer gsap html2canvas');

const heroCliBtn = document.querySelector<HTMLButtonElement>('.cli-pill .cli-btn');
setupCopy(heroCliBtn, () => 'npm i theme.changer');

// Keyboard shortcuts: 't' for toggle, 'd' for panel inspector, 'r' for replay
const TEXT_ENTRY =
  'input:not([type="range"]):not([type="checkbox"]):not([type="button"]), textarea, select, [contenteditable="true"]';

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  if (target instanceof Element && target.closest(TEXT_ENTRY)) return;

  switch (e.key.toLowerCase()) {
    case 't':
      ink.toggle();
      panel.refresh();
      break;
    case 'd':
      panel.toggle();
      break;
    case 'r':
      ink.replay();
      break;
    default:
      return;
  }
  e.preventDefault();
});

if (params.get('auto') === '1') {
  startAutoMode(ink, () => showMarker, () => panel.refresh());
}

if (params.get('panel') === '1') {
  panel.toggle();
}

if (import.meta.env.DEV) {
  Object.assign(window, { __ink: ink, __gsap: gsap, __spread: SPREAD, __panel: panel });
  void import('./dev/probe').then((m) => m.installProbe(ink));
}
