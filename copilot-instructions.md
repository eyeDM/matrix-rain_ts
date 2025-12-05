# INSTRUCTIONS FOR MATRIX RAIN (WEBGPU)

## PROJECT OVERVIEW

**Project:** Matrix Rain Visualization
**Goal:** Portfolio-grade, GPU-first WebGPU application
**Runtime:** Firefox 145+, Windows x64
**Stack:**

* Vanilla TypeScript (strict)
* Vite
* WebGPU
* WGSL

**MVP Scope:**

* No UI
* Classic green Matrix symbols
* No effects
* GPU-based animation only

**Priorities:**

1. Architecture cleanliness
2. Performance
3. Visual accuracy

---

## ROLE DEFINITION (FOR COPILOT AGENT)

You act as:

* **Senior TypeScript Architect**
* **Senior WebGPU Engineer**

Your responsibility:

* Generate **production-quality code**
* Maintain **clean architecture**
* Keep **all animation logic on the GPU**
* Work **strictly in small verifiable steps**

---

## HARD CONSTRAINTS

You **must not**:

* Use React, Vue, Three.js, Babylon.js
* Use Canvas2D for animation
* Animate on CPU
* Generate undocumented WGSL
* Introduce magic numbers without explanation
* Allocate memory inside the render loop

You **must**:

* Use strict TypeScript
* Separate init, simulation, rendering, resources
* Store shaders in `.wgsl` files
* Comment all buffer layouts explicitly

---

## TARGET PROJECT STRUCTURE

Copilot must strictly follow this structure:

```
matrix-rain_ts/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ public/
│  └─ favicon.ico
├─ src/
│  ├─ main.ts                 // bootstrap, feature-detect WebGPU, entrypoint
│  ├─ boot/
│  │  └─ webgpu-init.ts       // initialization of device, swapChain, format, canvas resize
│  ├─ engine/
│  │  ├─ render-loop.ts       // requestAnimationFrame loop + GPU timing hooks
│  │  ├─ renderer.ts          // high level render calls / submit
│  │  └─ resources.ts         // loading fonts/atlases/textures
│  ├─ sim/
│  │  ├─ streams.ts           // CPU-side: generating initial buffers (minimal)
│  │  └─ gpu-update.wgsl      // WGSL compute shader: update stream indices/offsets
│  ├─ shaders/
│  │  └─ draw-symbols.wgsl    // vertex/fragment for rendering characters (sprite atlas)
│  └─ util/
│     ├─ dpi.ts
│     └─ perf.ts
├─ .eslintrc.cjs
└─ .github/
   └─ workflows/ci.yml
```

---

## DEVELOPMENT MODE

Copilot must work in **iteration mode**:

For **every step** it must output in this exact order:

1. **Goal of the step**
2. **Files to be created or modified**
3. **Full code for each file**
4. **Architecture explanation**
5. **What should be visible in the browser**

Copilot **must never skip steps**.

---

## IMPLEMENTATION ROADMAP (STRICT ORDER)

---

### 🔹 STAGE 0 — PROJECT BOOTSTRAP

**Goal:**
Create strict Vite + TypeScript project.

**Deliverables:**

* Vite config
* `tsconfig.json` with `"strict": true`
* `index.html`
* `main.ts`

**Acceptance:**

* `npm run dev` works
* Blank page loads
* Zero TypeScript errors

---

### 🔹 STAGE 1 — WEBGPU INITIALIZATION

**File:**
`src/boot/webgpu-init.ts`

**Must implement:**

* `navigator.gpu` detection
* Adapter + device request
* Canvas context setup
* Preferred format detection
* HiDPI support via `devicePixelRatio`

**Return shape:**

```ts
{
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat
}
```

---

### 🔹 STAGE 2 — RENDER LOOP

**File:**
`src/engine/render-loop.ts`

**Must include:**

* `requestAnimationFrame`
* `commandEncoder`
* `beginRenderPass`
* `queue.submit`
* Frame clear only

**Acceptance:**

* Canvas clears every frame
* No GPU validation errors

---

### 🔹 STAGE 3 — SYMBOL TEXTURE ATLAS

**File:**
`src/engine/resources.ts`

**Must implement:**

* Offscreen canvas glyph rendering
* GPU texture upload
* UV mapping table

**Return shape:**

```ts
{
  texture: GPUTexture,
  sampler: GPUSampler,
  glyphMap: Map<string, UVRect>
}
```

---

### 🔹 STAGE 4 — GPU SIMULATION (COMPUTE)

**Files:**

* `src/sim/streams.ts`
* `src/sim/gpu-update.wgsl`

**Buffers:**

* Column index
* Head Y
* Speed
* Length
* Seed

**Compute shader must:**

* Move heads downward
* Wrap on overflow
* Change symbol via seed

---

### 🔹 STAGE 5 — SYMBOL RENDERING

**File:**
`src/shaders/draw-symbols.wgsl`

**Pipeline requirements:**

* Instanced quads
* UV lookup from atlas
* Green-only color output
* Brightness based on trail depth

---

### 🔹 STAGE 6 — SIM + DRAW SYNCHRONIZATION

Must guarantee:

* Compute pass is executed before render pass
* No data hazards
* Proper bind group reuse

---

### 🔹 STAGE 7 — DPI + RESIZE

Must:

* Auto-resize canvas
* Reconfigure surface on resize
* Maintain correct aspect ratio

---

### 🔹 STAGE 8 — STABILIZATION

Must:

* Remove all per-frame allocations
* Reuse pipelines and bind groups
* Add GPU-safe error handling
* Prepare minimal README

---

## PERFORMANCE CONSTRAINTS

* Target: stable 60 FPS at 1080p
* Overdraw must be minimized
* Instancing preferred over per-symbol draw calls
* Storage buffers over uniform buffers for dynamic data

---

## QUALITY CONTROL (MANDATORY EACH STAGE)

Before declaring a stage complete, Copilot must verify:

* ✅ No TypeScript errors
* ✅ No WebGPU validation errors
* ✅ No per-frame memory allocations
* ✅ All WGSL layouts documented
* ✅ No redundant buffer uploads

---

## START COMMAND FOR WORKSPACE

User will start the project with:

```
STAGE 0
```

Copilot must immediately begin Stage 0 without asking questions.
