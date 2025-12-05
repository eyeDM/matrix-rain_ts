/*
GPU Simulation Compute Shader - gpu-update.wgsl

Buffers layout (group 0):
 - binding 0: uniform Params { dt: f32; rows: u32; cols: u32; pad: u32; }
 - binding 1: storage heads: array<f32>           // current head Y position per column
 - binding 2: storage speeds: array<f32>          // speed in cells per second per column
 - binding 3: storage lengths: array<u32>         // trail length in cells per column
 - binding 4: storage seeds: array<u32>           // PRNG seed per column
 - binding 5: storage columns: array<u32>         // column indices (optional)

All storage buffers are declared as read_write because the compute shader
updates head positions, seeds, speeds, and lengths in-place.

The compute kernel advances each head by `speed * dt`, wraps when >= rows,
and when wrapping updates the seed using an LCG, then derives new speed/length
from the seed. Symbol changes can be driven by the seed in the rendering stage.

WGSL implementation:

*/

struct Params {
  dt: f32,
  rows: u32,
  cols: u32,
  glyphCount: u32,
  cellWidth: f32,
  cellHeight: f32,
  pad0: vec2<f32>
}

@group(0) @binding(0)
var<uniform> params: Params;

@group(0) @binding(1)
var<storage, read_write> heads: array<f32>;

@group(0) @binding(2)
var<storage, read_write> speeds: array<f32>;

@group(0) @binding(3)
var<storage, read_write> lengths: array<u32>;

@group(0) @binding(4)
var<storage, read_write> seeds: array<u32>;

@group(0) @binding(5)
var<storage, read> columns: array<u32>;

// Glyph UV lookup table: one vec4<u32> per glyph: u0, v0, u1, v1 (normalized)
@group(0) @binding(6)
var<storage, read> glyphUVs: array<vec4<f32>>;

struct InstanceOut {
  offset: vec2<f32>,
  cellSize: vec2<f32>,
  uvRect: vec4<f32>
}

@group(0) @binding(7)
var<storage, read_write> instancesOut: array<InstanceOut>;

// Linear Congruential Generator constants (32-bit)
const LCG_A: u32 = 1664525u;
const LCG_C: u32 = 1013904223u;

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

  // Emit a simple instance representing the column head so the render pipeline
  // can directly sample the atlas. instancesOut has length == params.cols.
  // offset.x = column * cellWidth, offset.y = head * cellHeight
  instancesOut[i].offset = vec2<f32>(f32(i) * params.cellWidth, head * params.cellHeight);
  instancesOut[i].cellSize = vec2<f32>(params.cellWidth, params.cellHeight);
  let glyphIdx: u32 = seeds[i] % params.glyphCount;
  instancesOut[i].uvRect = glyphUVs[glyphIdx];
}
