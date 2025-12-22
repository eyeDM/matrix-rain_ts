# Matrix Rain Visualization (TypeScript + WebGPU)

**Matrix Rain Visualization** is a portfolio-grade, GPU-first implementation of the iconic “Matrix digital rain” effect, built entirely on **WebGPU** using **vanilla TypeScript (strict)** and **WGSL**.

The project demonstrates how to design a **fully GPU-driven animation pipeline** where:
- All simulation logic runs on the GPU via compute shaders.
- The CPU acts only as an orchestrator (initialization, resize handling, uniform updates).
- Rendering is instanced, batched, and highly scalable.

It is designed as a reference-quality example of modern WebGPU architecture for real-time GPU-driven effects, suitable for both learning and portfolio presentation.

## Prerequisites
- Node.js 18+
- Browser with WebGPU support (Chrome/Edge Canary or recent stable with flag). See "Troubleshooting" below.

## Quick start (PowerShell)
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
 ├─ Initializes WebGPU
 ├─ Creates persistent GPU resources
 ├─ Updates uniforms (dt, screen size)
 └─ Submits command buffers per frame
        ↓
GPU (WebGPU)
 ├─ Compute pass: simulation (WGSL)
 │    └─ Updates stream heads, speeds, glyphs, brightness
 └─ Render pass: instanced drawing (WGSL)
      └─ Draws all glyph quads in a single draw call
```

### Key principles

- **GPU-first simulation**

    No per-frame CPU-side simulation. Column logic, randomness, trail generation, and brightness falloff are handled entirely in a compute shader.

- **Deterministic & column-local**

    Each column has its own PRNG seed and state, ensuring stable behavior and zero inter-column synchronization.

- **Fixed-capacity buffers**

    Each column reserves `MAX_TRAIL` slots. No compaction, no prefix sums, no readbacks.

- **Explicit memory layouts**

    All CPU ↔ GPU layouts are defined once in `src/gpu/layouts.ts` and mirrored exactly in WGSL.

- **Resilient render loop**

    Errors in passes or swap-chain acquisition do not kill the animation loop.

---

## Project Structure
```
src/
├─ boot/
│  └─ webgpu-init.ts        # Adapter/device/context initialization
│
├─ engine/
│  ├─ render-loop.ts        # requestAnimationFrame loop
│  ├─ render-graph.ts       # DAG-based render pass execution
│  ├─ simulation-graph.ts   # Compute-only pass graph
│  ├─ renderer.ts           # Pipelines, bind groups, passes
│  ├─ resource-manager.ts   # Explicit GPU resource ownership
│  └─ resources.ts          # Glyph atlas + instance buffer
│
├─ gpu/
│  └─ layouts.ts            # Canonical CPU↔GPU memory layouts
│
├─ shaders/
│  └─ draw-symbols.wgsl     # Instanced glyph rendering
│
├─ sim/
│  ├─ gpu-update.wgsl       # Compute shader (simulation)
│  ├─ streams.ts            # Simulation buffers
│  └─ simulation-uniform-writer.ts  # SimulationUniforms owner
│
├─ main.ts                  # Application bootstrap
index.html
```

### Core subsystems

1. **WebGPU initialization**

    - Adapter selection with high-performance preference
    - HiDPI-aware canvas configuration
    - Safe reconfiguration on resize

2. **Glyph atlas**

    - Glyphs rendered once into an offscreen canvas
    - Uploaded as a single `rgba8unorm` texture
    - UV rectangles stored in a GPU storage buffer for compute access

3. **Simulation (compute shader)**

    - One workgroup per column (`@workgroup_size(64)`)
    - Updates:
        * Head position
        * Speed
        * Trail length
        * Glyph selection
        * Brightness gradient
    - Outputs directly into the instance buffer consumed by the rendere

4. **Rendering**

    - Single quad vertex buffer
    - Fully instanced draw (`draw(6, instanceCount)`)
    - Alpha blending for smooth trails
    - Screen-space positioning via uniforms

5. **RenderGraph**

    - Declarative pass dependencies
    - Topological sorting per frame
    - Clean separation between compute and draw passes

---

## Important notes

- The simulation emits a fixed number of trail slots per column (`MAX_TRAIL`). If you change `MAX_TRAIL` in `src/sim/gpu-update.wgsl`, update the corresponding value in `src/main.ts` to match.

- If you see shader compilation errors in the browser, copy the full "WebGPU compilation info" message (it includes the WGSL line/column and message) and paste it into an issue — that info is necessary to pinpoint WGSL problems.

- **No per-frame allocations**

    All buffers, pipelines, bind groups, and textures are created upfront or on resize only.

- **Safe resource destruction**

    Old GPU resources are destroyed only after device.queue.onSubmittedWorkDone() to avoid validation errors.

- **Strict layout contracts**

    Any change in gpu/layouts.ts must be mirrored in WGSL structs. This is intentional and enforced by design.

- **Scalability**

    Performance scales primarily with:
    * Column count (`canvasWidth / cellWidth`)
    * `MAX_TRAIL`
    Both are GPU-bound, not CPU-bound.

- **Extensibility**

    The architecture supports:
    * Post-processing passes
    * Multi-layer rain
    * Color variation per column
    * Bloom / glow via additional render passes

## Troubleshooting WebGPU
- Chrome/Edge: enable the `chrome://flags/#enable-unsafe-webgpu` or run a Canary/Dev version with WebGPU support if your browser doesn't expose WebGPU yet.
- If WebGPU is not available, the app will throw at startup — check the console for the adapter/device request errors.

## License
This repo is for learning and experimentation. No license specified.
