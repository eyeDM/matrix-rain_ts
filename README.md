# Matrix Rain Visualization (AI + TypeScript + WebGPU)

**Matrix Rain Visualization** is a portfolio-grade, GPU-first implementation of the iconic “Matrix digital rain” effect, built entirely on **WebGPU** using **vanilla TypeScript (strict)** and **WGSL**.

The project demonstrates how to design a **fully GPU-driven animation pipeline** where:
- All simulation logic runs on the GPU via compute shaders.
- The CPU acts only as an orchestrator (initialization, resize handling, uniform updates).
- Rendering is instanced, batched, and highly scalable.

It is designed as a reference-quality example of modern WebGPU architecture for real-time GPU-driven effects, suitable for both learning and portfolio presentation.

## Prerequisites

- Node.js 18+
- Browser with WebGPU support (Chrome/Edge Canary or recent stable with flag). See "Troubleshooting" below.

## Quick start

Install dependencies:
```shell
npm install
```
Run dev server:
```shell
npm run dev
```
Open `http://localhost:5173` (or the URL printed by Vite).

Type-check only:
```shell
npx tsc --noEmit
```

Build for production:
```shell
npm run build
```

---

## Architecture Overview

### High-level overview

The project is organized around a GPU-centric frame pipeline where the CPU orchestrates resources and the GPU performs all simulation and rendering work:

```
CPU (TypeScript)
 ├─ Initializes WebGPU and swapchain
 ├─ Creates device-lifetime resources (pipelines, shader modules, layouts)
 ├─ Builds surface-lifetime resources and the render graph (init / resize)
 ├─ Updates per-frame uniforms (dt, time, screen size)
 ├─ Creates a command encoder per frame
 └─ Submits GPU passes in deterministic order
 ↓
GPU (WebGPU, WGSL)
 ├─ SimulationComputePass: GPU-only update of per-column state (head, speed, trail, PRNG seed); writes instance data used by the draw pass.
 ├─ DrawPass: Instanced rendering of glyph quads into an offscreen color target and a separate "bright" target; uses formats such as `bgra8unorm-srgb` (color) and `rgba16float` (brightness/high-dynamic targets).
 ├─ HistoryPass: Accumulates a decaying history buffer (exponential decay) to create persistence/trail effects; uses `rgba16float` for intermediate precision.
 ├─ BlurPass: Separable Gaussian blur on the bright target to produce bloom; implemented as two passes (horizontal, vertical) to keep workgroup sizing reasonable.
 └─ PresentPass: Composite and tone-map the offscreen targets to the swapchain with optional CRT-like stylization and final color transforms.
```

### Dependency flow

The project follows a strict top-down dependency flow. Each layer depends only on the layers below it and never in the opposite direction. This keeps the architecture predictable, testable, and free of hidden coupling.

High-level application and runtime code orchestrate execution, GPU passes encode commands without owning platform details, backend code provides thin WebGPU abstractions, and WGSL shaders form the lowest-level implementation.

```
app (bootstrap)
 ↓
runtime (render loop, swapchain, resize)
 ↓
domain (glyph atlas)
 ↓
gpu (passes, render graph, execution)
 ↓
backend (WebGPU abstractions)
 ↓
assets (WGSL)
```

### Core subsystems

- **Backend (WebGPU):** Adapter/device initialization, shader loading, typed CPU↔GPU memory layouts and scoped resource management (device / surface / frame). See `src/backend`.

- **Glyph atlas (domain):** CPU rasterization into an offscreen canvas, one-time upload to a GPU texture and a storage buffer of per-glyph UV rects used by shaders. See `src/domain/glyph-atlas.ts`.

- **Simulation (compute):** GPU-only per-column update of `ColumnState` (head, speed, energy, length, PRNG seed); compute pipeline dispatches columns with a workgroup strategy (workgroup size tuned in code). See `src/gpu/simulation-pass.ts` and `src/assets/shaders/simulation.wgsl`.

- **Rendering (draw):** Instanced quad rendering of glyphs into offscreen color and bright targets (LDR color + HDR bright) with vertex/fragment pipelines and atlas sampling. See `src/gpu/draw-pass.ts` and `src/assets/shaders/draw.wgsl`.

- **Post-processing:** Separable blur (horizontal/vertical) and a history accumulation pass that ping-pongs HDR history textures to produce trails and bloom inputs. See `src/gpu/blur-pass.ts` and `src/gpu/history-pass.ts`.

- **Present:** Final composite and tone-map pass that samples history + bloom and writes to the swapchain. See `src/gpu/present-pass.ts` and `src/assets/shaders/present.wgsl`.

- **Render graph & loop:** A small render-graph arranges pass dependencies (reads/writes) and executes passes deterministically each frame. See `src/gpu/render-graph.ts` and `src/app/main.ts`.

### File Structure

```
matrix-rain_ts/
├─ public/
│  └─ favicon.svg
│
├─ src/
│  ├─ app/              # Application bootstrap
│  │  └─ index.html
│  ├─ runtime/          # App-level orchestration
│  ├─ gpu/              # WebGPU execution layer
│  ├─ backend/          # WebGPU platform abstractions
│  ├─ domain/
│  └─ assets/           # Static GPU assets
│     └─ shaders/
│
├─ README.md
├─ package.json
├─ tsconfig.json
└─ vite.config.ts
```

---

## Technical Overview

### Strengths

- GPU-first simulation: All per-frame simulation runs in compute shaders, keeping CPU overhead minimal.
- Deterministic, column-local logic: Each column owns its PRNG and state, avoiding inter-column synchronization.
- Explicit memory layouts: CPU↔GPU layouts are defined centrally (see `src/backend/layouts.ts`) and mirrored in WGSL for correctness.
- Fixed-capacity buffers: Simpler lifetime and memory management on the GPU (no compaction or readback), which keeps shaders and resource lifetimes straightforward.
- Modular pipeline design: Passes (simulation, draw, blur, history, present) are separated by responsibility and encoded in a render graph for deterministic ordering.

### Known limitations & trade-offs

- Portability: The project relies on WebGPU features and specific texture formats (`rgba16float`, `bgra8unorm-srgb`); not all browsers/devices expose the same capabilities—feature checks and graceful fallbacks are limited.
- Memory efficiency: Fixed-capacity per-column trails simplify the GPU code but can waste GPU memory on very large canvases or high row counts.
- No CPU-side fallback: There is no fallback rendering path for environments without WebGPU; the app expects a capable device.
- Resize and resource churn: Surface-lifetime resource re-creation on resize is explicit but can be expensive on some drivers; pay attention to the frequency of expensive device/swapchain operations.
- Color management: SRGB vs linear handling is simplified; subtle color/tone mapping differences may appear across GPUs.
- Glyph fidelity: The glyph atlas uses an offscreen canvas rasterization; this is practical but differs from system font rendering and may need adjustments for different font sizes or DPI.

### Implementation notes & attention points for contributors

- Shaders: All WGSL shader sources live under `src/assets/shaders/` (e.g. `simulation.wgsl`, `draw.wgsl`, `blur.wgsl`, `history.wgsl`, `present.wgsl`). Keep shader memory layout comments in sync with `src/backend/layouts.ts`.
- Compute/workgroup sizing: The simulation uses a workgroup strategy tuned for columns (see `src/gpu/simulation-pass.ts`). Avoid changing `@workgroup_size` without validating dispatch calculations.
- Instance buffer updates: The compute shader writes instance data directly for the draw pass; the instance buffer layout must match the vertex/fragment expectations exactly.
- Formats and precision: Use `rgba16float` for intermediate high-dynamic targets (bright/history) to reduce banding; ensure the device supports the required texture formats and usages.
- Strict TypeScript: The project uses strict TypeScript settings (`tsconfig.json`); maintain explicit typings and avoid `any` to keep interfaces robust.
- No magic numbers: Maintain named constants for sizes (rows, columns, maxTrail) and document assumptions in `src/gpu/` modules.

---

## License

This repo is for learning and experimentation. No license specified.
