// gpu-update.wgsl
// * GPU Simulation Compute Shader *
//
// Buffers layout (group 0):
//  - binding 0: uniform Params { dt: f32; rows: u32; cols: u32; glyphCount: u32; cellWidth: f32; cellHeight: f32; }
//  - binding 1: storage heads: array<f32>                // current head Y position per column
//  - binding 2: storage speeds: array<f32>               // speed in cells per second per column
//  - binding 3: storage lengths: array<u32>              // trail length in cells per column
//  - binding 4: storage seeds: array<u32>                // PRNG seed per column
//  - binding 5: storage columns: array<u32>              // column indices (optional index buffer)
//  - binding 6: storage glyphUVs: array<vec4<f32>>       // per-glyph UV rects (u0,v0,u1,v1) in normalized float
//  - binding 7: storage instancesOut: array<InstanceOut> // output instances (per-column fixed slots)
//
// All storage buffers are declared as read_write when the shader needs to mutate them,
// and read-only when the shader only reads (e.g. `columns`, `glyphUVs`). The compute
// shader advances heads, updates seeds/speeds/lengths when wrapping, and writes
// per-column trail instances into a preallocated `instancesOut` array.
//
// The compute kernel advances each head by `speed * dt`, wraps when >= rows,
// and when wrapping updates the seed using an LCG, then derives new speed/length
// from the seed. Symbol changes can be driven by the seed in the rendering stage.

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

@group(0) @binding(0) var<uniform> params: Params;
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
  if (i >= params.cols) {
    return;
  }

  var head: f32 = heads[i];
  var speed: f32 = speeds[i];

  // Advance head by speed * dt (cell units)
  head = head + speed * params.dt;

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
