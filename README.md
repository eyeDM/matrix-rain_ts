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
```bash
npm install
```
Run dev server:
```bash
npm run dev
```
Open `http://localhost:5173` (or the URL printed by Vite).

Type-check only:
```bash
npx tsc --noEmit
```

Build for production:
```bash
npm run build
```

---

## Project Architecture

### High-level overview

The project is organized around a **GPU-centric frame pipeline**:
```
CPU (TypeScript)
 ├─ Initializes WebGPUand swapchain
 ├─ Creates device-lifetime resources (pipelines, shaders, layouts)
 ├─ Builds surface-lifetime resources and render graph (init / resize)
 ├─ Updates uniforms (dt, screen size)
 ├─ Creates a command encoder per frame
 └─ Submits GPU passes in deterministic order
  ↓
GPU (WebGPU, WGSL)
 ├─ SimulationComputePass: Updates ColumnState per column, renewal and rebirth of columns of symbols with "living" energy.
 ├─ DrawPass: Renders all glyph instances into an offscreen color target; procedural render shader with glyph selection, position calculation, color ("bgra8unorm-srgb"), brightness ("rgba16float"), transparency.
 ├─ BlurPass: Separable Gaussian blur pass for bloom. Large glyphs create a parallax effect. The input is `out.bright` from `draw.wgsl`. "rgba16float".
 ├─ HistoryPass: Simple history accumulation with exponential decay. "rgba16float".
 └─ PresentPass: Final-frame presentation with a stylized CRT aesthetic.
```

### Key principles

- **GPU-first simulation**

    No per-frame CPU-side simulation. Column logic, randomness, trail generation, and brightness falloff are handled entirely in a compute shader.

- **Deterministic & column-local**

    Each column has its own PRNG seed and state, ensuring stable behavior and zero inter-column synchronization.

- **Fixed-capacity buffers**

    Each column reserves a fixed-capacity trail segment (`maxTrail`), computed once from the visible row count and treated as immutable for the lifetime of the scene. No compaction, no prefix sums, no readbacks.

- **Explicit memory layouts**

    All CPU ↔ GPU layouts are defined once in `src/backend/layouts.ts` and mirrored exactly in WGSL.

- **Explicit lifetimes**

    Resources are scoped to device, surface, or frame.

- **Resilient render loop**

    Errors in passes or swap-chain acquisition do not kill the animation loop.

---

## Project Structure
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

1. **Backend (WebGPU)**

    - Adapter and device initialization
    - Shader module compilation and management
    - Resource scopes: device-, surface-, frame-lifetime
    - Safe reconfiguration of swapchain and canvas on resize

2. **Glyph atlas (domain layer)**

    - Glyphs rendered once into an offscreen canvas
    - Uploaded as a GPU texture with sampler
    - UV coordinates stored in a GPU buffer for simulation and rendering
    - Pure domain logic, independent of GPU execution

3. **Simulation (compute pass, GPU layer)**

    - One workgroup per column (`@workgroup_size(64)`)
    - Updates entirely on GPU:
        * Head positions
        * Speeds
        * Trail lengths
        * Glyph selection
        * Brightness gradient
    - Writes directly into the instance buffer for rendering
    - Surface-lifetime resources updated on resize

4. **Rendering (draw pass, GPU layer)**

    - Single quad vertex buffer
    - Fully instanced draw (`draw(6, instanceCount)`)
    - Alpha blending for smooth trails
    - Screen-space positioning via uniforms
    - Surface-lifetime resources recreated on resize

5. **Present pass (GPU layer)**

    - Composites offscreen render target to swapchain
    - Fullscreen triangle, clear and store ops
    - Receives frame-lifetime `GPUTextureView` from swapchain

6. **RenderGraph**

    - Declarative pass dependencies (`reads` / `writes`)
    - Topological sorting per frame
    - Passes encode commands only; do not own resources
    - Ensures deterministic execution and separation between compute, draw, and present passes

---

## License

This repo is for learning and experimentation. No license specified.
