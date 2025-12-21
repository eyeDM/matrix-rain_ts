// sim/gpu-update.wgsl
// -----------------------------------------------------------------------------
// GPU Simulation Compute Shader (Unified SimulationUniforms)
//
// This compute shader performs the per-column simulation step for Matrix streams.
// It is fully GPU-driven and operates on persistent buffers with no per-frame
// allocations. All simulation parameters and temporal data are provided through
// a single uniform block: `SimulationUniforms`.
//
// Design principles:
// - Single authoritative uniform block (SimulationUniforms)
// - One CPU → GPU uniform upload per frame
// - Deterministic, column-local simulation
// - No frame orchestration or control flow on the CPU
//
// Buffers layout (group 0):
//
//  - binding 0: uniform SimulationUniforms
//      {
//        dt: f32;           // delta time for the current frame (seconds)
//        rows: u32;         // number of rows in the grid
//        cols: u32;         // number of columns (stream count)
//        glyphCount: u32;   // total glyphs in the atlas
//        cellWidth: f32;    // glyph cell width in pixels
//        cellHeight: f32;   // glyph cell height in pixels
//        pad0: vec2<f32>;   // explicit padding (16-byte alignment)
//      }
//
//  - binding 1: storage, read_write heads: array<f32>
//      // current head Y position per column (in cell units)
//
//  - binding 2: storage, read_write speeds: array<f32>
//      // fall speed in cells per second per column
//
//  - binding 3: storage, read_write lengths: array<u32>
//      // trail length in cells per column
//
//  - binding 4: storage, read_write seeds: array<u32>
//      // deterministic PRNG seed per column
//
//  - binding 5: storage, read columns: array<u32>
//      // column indices (optional indirection / index buffer)
//
//  - binding 6: storage, read glyphUVs: array<vec4<f32>>
//      // per-glyph UV rectangles (u0, v0, u1, v1), normalized
//
//  - binding 7: storage, read_write instancesOut: array<InstanceOut>
//      // fixed-size output instance slots (MAX_TRAIL per column)
//
// Simulation behavior:
// - Each column advances its head by `speed * sim.dt`.
// - When the head wraps past `rows`, a new speed and trail length are derived
//   from a deterministic LCG-based PRNG.
// - Trail instances are emitted into preallocated slots without compaction.
// - All randomness is deterministic and column-local.
// - The CPU only updates SimulationUniforms; all animation logic lives here.
// -----------------------------------------------------------------------------


// MUST match SimulationUniformLayout (32 bytes, align 16)
struct SimulationUniforms  {
  dt: f32,
  rows: u32,
  cols: u32,
  glyphCount: u32,
  cellWidth: f32,
  cellHeight: f32,
  pad0: vec2<f32>,
};

// MUST match InstanceLayout (48 bytes, align 16)
struct InstanceOut {
  offset: vec2<f32>,
  cellSize: vec2<f32>,
  uvRect: vec4<f32>,
  brightness: f32,
  pad0: vec3<f32>,
};

@group(0) @binding(0) var<uniform> sim: SimulationUniforms;
@group(0) @binding(1) var<storage, read_write> heads: array<f32>;
@group(0) @binding(2) var<storage, read_write> speeds: array<f32>;
@group(0) @binding(3) var<storage, read_write> lengths: array<u32>;
@group(0) @binding(4) var<storage, read_write> seeds: array<u32>;
@group(0) @binding(5) var<storage, read> columns: array<u32>;
@group(0) @binding(6) var<storage, read> glyphUVs: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> instancesOut: array<InstanceOut>;

// Linear Congruential Generator constants (32-bit)
const LCG_A: u32 = 1664525u;
const LCG_C: u32 = 1013904223u;

// Maximum trail samples per column. Must match JS `MAX_TRAIL`.
const MAX_TRAIL: u32 = 250u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i: u32 = gid.x;
  if (i >= sim.cols) {
    return;
  }

  var head: f32 = heads[i];
  var speed: f32 = speeds[i];

  // Advance head by speed * dt (cell units)
  head = head + speed * sim.dt;

  // Wrap and respawn logic
  if (head >= f32(sim.rows)) {
    // wrap-around
    head = head - f32(sim.rows);

    // update PRNG seed using LCG
    var s: u32 = seeds[i];
    s = s * LCG_A + LCG_C;
    seeds[i] = s;

    // derive pseudo-random value in [0,1)
    let r: f32 = f32(s & 0xffffu) / 65536.0;

    // choose a new length and speed based on pseudo-random
    lengths[i] = 3u + u32(r * 20.0);  // length in cells
    speeds[i] = 6.0 + r * 40.0;       // speed (cells/sec)
  }

  heads[i] = head;

  // Emit trail instances for this column. We reserve a fixed maximum trail
  // length per column and write instances at index = i * MAX_TRAIL + t
  // so the CPU does not need to compact results. This keeps the pipeline
  // simple and predictable.
  var len: u32 = lengths[i];
  if (len > MAX_TRAIL) { len = MAX_TRAIL; }

  // Emit entries: head (t==0) downwards; brightness decreases with t
  // Use a per-sample PRNG derived from the column seed so each sample can
  // pick a different glyph without modifying the column's persistent seed.
  var t: u32 = 0u;
  loop {
    if (t >= len) { break; }
    // compute row position for this trail sample (wrap negative)
    var rowPos: i32 = i32(floor(head)) - i32(t);
    if (rowPos < 0) {
      rowPos = rowPos + i32(sim.rows);
    }
    let idx: u32 = i * MAX_TRAIL + t;
    instancesOut[idx].offset = vec2<f32>(f32(i) * sim.cellWidth, f32(rowPos) * sim.cellHeight);
    instancesOut[idx].cellSize = vec2<f32>(sim.cellWidth, sim.cellHeight);

    // Per-sample PRNG: mix column seed with sample index, run one LCG step
    var s: u32 = seeds[i] + t * 747796405u;
    s = s * LCG_A + LCG_C;
    let glyphIdx: u32 = s % sim.glyphCount;
    instancesOut[idx].uvRect = glyphUVs[glyphIdx];

    // brightness: 1.0 for head, decreasing to ~0 for tail
    instancesOut[idx].brightness = 1.0 - (f32(t) / f32(max(1u, len - 1u)));
    // pad left unchanged
    t = t + 1u;
  }
}
