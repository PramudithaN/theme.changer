# theme.changer

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![WebGL2](https://img.shields.io/badge/WebGL2-990000?style=for-the-badge&logo=webgl&logoColor=white)
![GSAP](https://img.shields.io/badge/GSAP-88CE02?style=for-the-badge&logo=greensock&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E)
![NPM](https://img.shields.io/badge/NPM-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)
[![Live Demo](https://img.shields.io/badge/Demo-GitHub_Pages-2ea44f?style=for-the-badge&logo=github)](https://pramudithan.github.io/theme.changer/)

A high-performance organic theme transition engine that replaces abrupt cuts and standard opacity fades with fluid, procedurally-shaded transitions (Ink Bleed, Watercolor, Smoke, Ember, and Liquid Ripple) powered by WebGL2 fragment shaders, noise textures, and smart viewport snapshotting.

**Go check it out**: [https://pramudithan.github.io/theme.changer/](https://pramudithan.github.io/theme.changer/)

---

## Features

- **5 Procedural Presets**:
  - **Ink** *(Classic)*: Organic pigment bleeding through porous paper with curling tendrils and speckles.
  - **Watercolor**: Translucent blooming diffusion with soft, feathered gradient edges.
  - **Smoke**: Turbulent atmospheric vapor with curling wisps and high drift velocity.
  - **Ember**: Hot burning paper frontier with vivid edge rims and rapid contour evolution.
  - **Ripple**: Cohesive circular fluid wave with minimal tendril dispersion.
- **Smart Viewport Capture**:
  - Captures only the active viewport rather than the entire document height, cutting snapshot overhead down to **~30-45ms** while eliminating GPU memory pressure on long pages.
  - Real-time switcher between `Viewport` and `Full` capture strategies.
- **View Transitions API & Graceful Fallbacks**:
  - Automatically leverages native `document.startViewTransition` when available and motion is enabled.
  - Full respect for `prefers-reduced-motion` and automatic recovery from WebGL context loss.
- **Production Inspector Panel**:
  - Press <kbd>D</kbd> or load with `?panel=1` to toggle the inspector.
  - Fast segmented preset selector, micro-toggles, and fine-tuning sliders for duration, tendrils, noise scale, edge softness, and drift.
  - Zero clutter, sub-millisecond telemetry readout (`42ms · WebGL2`), and persistence across reloads.
- **Dual Build NPM Package Ready**:
  - Full support for ESM (`dist/index.js`), CommonJS (`dist/index.cjs`), and complete TypeScript type declarations (`dist/index.d.ts`).

---

## Installing as an NPM Package

You can install `@pramuditha/theme.changer` in any modern web application:

```bash
npm install @pramuditha/theme.changer gsap html2canvas
```

### Basic Usage

```ts
import { createInkTransition } from '@pramuditha/theme.changer';

// Mount the GPU transition engine
const ink = createInkTransition({
  toggleButton: document.querySelector('#theme-toggle'),
  preset: 'ember', // 'ink' | 'watercolor' | 'smoke' | 'ember' | 'ripple'
  captureMode: 'viewport', // 'viewport' (fast) | 'full'
});

// Or trigger programmatically from any click coordinates
button.addEventListener('click', (e) => {
  ink.toggle({ x: e.clientX, y: e.clientY });
});
```

### React / Next.js Hook Integration

```tsx
import { useEffect, useRef } from 'react';
import { createInkTransition, type InkTransition } from 'theme.changer';

export function useThemeTransition() {
  const inkRef = useRef<InkTransition | null>(null);

  useEffect(() => {
    inkRef.current = createInkTransition({
      toggleButton: document.querySelector('#theme-toggle') as HTMLButtonElement,
      preset: 'ink',
      captureMode: 'viewport',
    });
  }, []);

  const toggleTheme = (e?: React.MouseEvent) => {
    if (e) {
      inkRef.current?.toggle({ x: e.clientX, y: e.clientY });
    } else {
      inkRef.current?.toggle();
    }
  };

  return { toggleTheme, ink: inkRef.current };
}
```

---

## Local Development & Showcase

```bash
# Clone the repository
git clone https://github.com/PramudithaN/theme.changer.git

# Navigate to directory
cd theme.changer

# Install dependencies
npm install

# Start development server
npm run dev

# Build both demo website and NPM package distribution
npm run build
```

### Keyboard Shortcuts in Demo

| Key | Action |
| --- | --- |
| <kbd>T</kbd> | Toggle theme (Light / Dark) |
| <kbd>D</kbd> | Open / Close Studio Inspector Panel |
| <kbd>R</kbd> | Replay last transition |

### URL Parameters

- `?panel=1`: Opens the inspector panel on page load.
- `?auto=1`: Runs automated hands-free theme toggling with click indicators.
- `?gl=0`: Forces the CSS fallback / View Transitions engine (simulates non-WebGL2 devices).

---

## Configuration & Shader Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `duration` | `number` | `1.4` | Duration of the expansion in seconds (before fade-out). |
| `tendril` | `number` | `1.0` | Filament curl and branching reach (0 = smooth blob). |
| `noiseScale` | `number` | `1.0` | Noise frequency multiplier (lower = broader shapes). |
| `softness` | `number` | `1.4` | Frontier half-width in CSS pixels. |
| `drift` | `number` | `1.0` | Speed at which noise contours evolve over time. |
| `timeScale` | `number` | `1.0` | Playback speed multiplier (`0.25` for slow-motion). |
| `captureMode` | `string` | `'viewport'` | `'viewport'` (fast, low memory) or `'full'` (full-page snapshot). |

---

## Technical Architecture

1. **Pre-Capture Phase**: In the background, `html2canvas` captures offscreen snapshots of the visible viewport in both themes.
2. **GPU Texture Upload**: The snapshots and a precomputed tileable gradient noise texture are bound to WebGL2 2D texture samplers.
3. **Procedural Frontier Shader**: A fragment shader evaluates a signed distance field combining:
   - Domain-warped Fractal Brownian Motion (FBM)
   - Anisotropic direction-only lobes
   - Curl tendrils along zero-crossing contour lines
   - High-frequency paper fibre noise
4. **Interactive Compositing**: Interrupting a transition mid-bleed captures the current composite frame directly from the GPU framebuffer and seamlessly starts a new expansion over the frozen frame.

---

## Acknowledgements & Attribution

Special credit and appreciation to [Codemure](https://github.com/codemure-official) for creating the original ink bleed transition base and shader foundation that this project builds upon.

---

## License

MIT License. Designed and maintained by [Pramuditha Nadun](https://www.pramuditha.is-a.dev/). Original base by [Codemure](https://github.com/codemure-official).
