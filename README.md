# Matrix Rain (TypeScript + WebGPU)

Minimal WebGPU Matrix Rain demo built with Vite + TypeScript.

## Prerequisites
- Node.js 18+ (or current LTS)
- A Chromium-based browser with WebGPU support (Chrome/Edge Canary or recent stable with flag). See "Troubleshooting" below.

## Quick start (PowerShell)
Install dependencies:
```powershell
npm install
```
Run dev server:
```powershell
npm run dev
```
Open `http://localhost:5173` (or the URL printed by Vite).

Type-check only:
```powershell
npx tsc --noEmit
```

Build for production:
```powershell
npm run build
```

Preview production build:
```powershell
npm run preview
```

## Project Structure (important files)
- `index.html` — contains the `#canvas` element.
- `src/main.ts` — app bootstrap, WebGPU init, resource creation, render loop, resize handling.
- `src/boot/webgpu-init.ts` — WebGPU adapter/device/context initialization.
- `src/sim/gpu-update.wgsl` — compute shader: stream simulation and instance emission.
- `src/sim/streams.ts` — GPU buffer creation and `updateParams` staging buffer reuse.
- `src/shaders/draw-symbols.wgsl` — vertex/fragment shader for instanced glyph rendering.
- `src/engine/renderer.ts` — creates compute + render pipelines and encodes per-frame work.

## Important notes
- The simulation emits a fixed number of trail slots per column (`MAX_TRAIL`). If you change `MAX_TRAIL` in `src/sim/gpu-update.wgsl`, update the corresponding value in `src/main.ts` to match.
- If you see shader compilation errors in the browser, copy the full "WebGPU compilation info" message (it includes the WGSL line/column and message) and paste it into an issue — that info is necessary to pinpoint WGSL problems.

## Troubleshooting WebGPU
- Chrome/Edge: enable the `chrome://flags/#enable-unsafe-webgpu` or run a Canary/Dev version with WebGPU support if your browser doesn't expose WebGPU yet.
- If WebGPU is not available, the app will throw at startup — check the console for the adapter/device request errors.

## License
This repo is for learning and experimentation. No license specified.
