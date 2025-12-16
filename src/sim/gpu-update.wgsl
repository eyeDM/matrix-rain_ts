// gpu-update.wgsl
// -----------------------------------------------------------------------------
// GPU Simulation Compute Shader
//
// This shader performs the core per-column simulation step for Matrix streams.
// It is executed as part of the SimulationGraph and contains no frame orchestration
// logic. All temporal data comes exclusively from FrameUniforms.
//
// Buffers layout (group 0):
//
//  - binding 0: uniform Frame
//      {
//        time: f32;        // global simulation time (seconds)
//        dt: f32;          // delta time for the current frame (seconds)
//        frameIndex: u32;  // monotonically increasing frame counter
//        noisePhase: f32;  // low-frequency temporal phase for deterministic noise
//      }
//
//  - binding 1: uniform Params
//      {
//        _dt_unused: f32;  // reserved (dt moved to FrameUniforms in Phase 0)
//        rows: u32;        // number of rows in the grid
//        cols: u32;        // number of columns (stream count)
//        glyphCount: u32;  // total glyphs in the atlas
//        cellWidth: f32;   // glyph cell width in pixels
//        cellHeight: f32;  // glyph cell height in pixels
//      }
//
//  - binding 2: storage, read_write heads: array<f32>
//      // current head Y position per column (in cell units)
//
//  - binding 3: storage, read_write speeds: array<f32>
//      // fall speed in cells per second per column
//
//  - binding 4: storage, read_write lengths: array<u32>
//      // trail length in cells per column
//
//  - binding 5: storage, read_write seeds: array<u32>
//      // deterministic PRNG seed per column
//
//  - binding 6: storage, read columns: array<u32>
//      // column indices (optional indirection / index buffer)
//
//  - binding 7: storage, read glyphUVs: array<vec4<f32>>
//      // per-glyph UV rectangles (u0, v0, u1, v1), normalized
//
//  - binding 8: storage, read_write instancesOut: array<InstanceOut>
//      // preallocated output instances (fixed slots per column)
//
// Notes:
// - All animation timing uses Frame.dt; Params no longer carry time information.
// - No CPU-side animation logic exists; CPU only updates uniforms.
// - The shader advances each head by `speed * frame.dt`, wraps when `>= rows`,
//   and on wrap updates the PRNG seed (LCG) to derive new speed and length.
// - Instance emission is deterministic and column-local.
// - Symbol selection and visual variation are driven by seeds and frame.noisePhase
//   in later simulation or rendering passes.
// - No per-frame allocations; all buffers are persistent.
// -----------------------------------------------------------------------------

struct Frame {
  time: f32,
  dt: f32,
  frameIndex: u32,
  noisePhase: f32,
};

struct Params {
  dt: f32,
  rows: u32,
  cols: u32,
  glyphCount: u32,
  cellWidth: f32,
  cellHeight: f32,
  pad0: vec2<f32>,
};

struct InstanceOut {
  offset: vec2<f32>,
  cellSize: vec2<f32>,
  uvRect: vec4<f32>,
  brightness: f32,
  pad: vec3<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> heads: array<f32>;
@group(0) @binding(3) var<storage, read_write> speeds: array<f32>;
@group(0) @binding(4) var<storage, read_write> lengths: array<u32>;
@group(0) @binding(5) var<storage, read_write> seeds: array<u32>;
@group(0) @binding(6) var<storage, read> columns: array<u32>;
@group(0) @binding(7) var<storage, read> glyphUVs: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> instancesOut: array<InstanceOut>;

// Linear Congruential Generator constants (32-bit)
const LCG_A: u32 = 1664525u;
const LCG_C: u32 = 1013904223u;

// Maximum trail samples per column. Must match JS `MAX_TRAIL`.
const MAX_TRAIL: u32 = 250u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i: u32 = gid.x;
  if (i >= params.cols) {
    return;
  }

  var head: f32 = heads[i];
  var speed: f32 = speeds[i];

  // Advance head by speed * dt (cell units)
  head = head + speed * frame.dt;

  // Wrap and respawn logic
  if (head >= f32(params.rows)) {
    // wrap-around
    head = head - f32(params.rows);

    // update PRNG seed using LCG
    var s: u32 = seeds[i];
    s = s * LCG_A + LCG_C;
    seeds[i] = s;

    // derive pseudo-random value in [0,1)
    let r: f32 = f32(s & 0xffffu) / 65536.0;

    // choose a new length and speed based on pseudo-random
    lengths[i] = 3u + u32(r * 20.0);           // length in cells
    speeds[i] = 6.0 + r * 40.0;                // speed (cells/sec)
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
      rowPos = rowPos + i32(params.rows);
    }
    let idx: u32 = i * MAX_TRAIL + t;
    instancesOut[idx].offset = vec2<f32>(f32(i) * params.cellWidth, f32(rowPos) * params.cellHeight);
    instancesOut[idx].cellSize = vec2<f32>(params.cellWidth, params.cellHeight);

    // Per-sample PRNG: mix column seed with sample index, run one LCG step
    var s: u32 = seeds[i] + t * 747796405u;
    s = s * LCG_A + LCG_C;
    let glyphIdx: u32 = s % params.glyphCount;
    instancesOut[idx].uvRect = glyphUVs[glyphIdx];

    // brightness: 1.0 for head, decreasing to ~0 for tail
    instancesOut[idx].brightness = 1.0 - (f32(t) / f32(max(1u, len - 1u)));
    // pad left unchanged
    t = t + 1u;
  }
}
