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
//  - binding 7: storage, read_write instances: array<InstanceData>
//      // fixed-size output instance slots (sim.maxTrail per column)
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
  maxTrail: u32,
  pad0: u32,
};

// MUST match InstanceLayout (48 bytes, align 16)
struct InstanceData {
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
@group(0) @binding(6) var<storage, read_write> energies: array<f32>;
@group(0) @binding(7) var<storage, read> glyphUVs: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> instances: array<InstanceData>;

const HEAD_ENERGY: f32 = 1.0; // physical impulse for brightness

// Linear Congruential Generator constants (32-bit)
const LCG_A: u32 = 1664525u;
const LCG_C: u32 = 1013904223u;

const HASH_MUL: u32 = 747796405u; // decorrelates glyphs along tail (PCG-style hash)

// --- Energy model constants ---
const ENERGY_BASE_MIN: f32 = 4.0;
const ENERGY_BASE_MAX: f32 = 8.0;
const ENERGY_PER_CELL: f32 = 1.25;

const BASE_HALF_LIFE: f32 = 4.5;
const ENERGY_SPEED_FACTOR: f32 = 0.35;
const ENERGY_LENGTH_FACTOR: f32 = 0.06;

const TRAIL_DECAY: f32 = 3.2;
const HEAD_BRIGHTNESS_BOOST: f32 = 1.15;

const LN2: f32 = 0.69314718056;

fn approxNormal01(seed: u32) -> f32 {
  var s: u32 = seed;
  var acc: f32 = 0.0;
  for (var i: u32 = 0u; i < 4u; i = i + 1u) {
    s = s * LCG_A + LCG_C;
    acc = acc + f32(s & 0xffffu) / 65536.0;
  }
  return acc * 0.25;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let columnIdx: u32 = gid.x;
  if (columnIdx >= sim.cols) {
    return;
  }

  var head: f32 = heads[columnIdx];
  var speed: f32 = speeds[columnIdx];
  var length: u32 = lengths[columnIdx];
  var energy: f32 = energies[columnIdx];

  // Advance head
  head = head + speed * sim.dt;

  let rowsF: f32 = f32(sim.rows);
  let respawn: bool = head >= rowsF;

  // Wrap and respawn logic
  if (respawn) {
    // wrap-around
    head = head - rowsF;

    // update PRNG seed
    var s: u32 = seeds[columnIdx];
    s = s * LCG_A + LCG_C;
    seeds[columnIdx] = s;

    // Respawn parameters
    let r: f32 = approxNormal01(s);
    length = 3u + u32(r * 20.0);  // length in cells
    speed = 3.5 + r * 24.0;       // speed (cells/sec)

    let energyBase: f32 =
      ENERGY_BASE_MIN + (ENERGY_BASE_MAX - ENERGY_BASE_MIN) * r;

    let energyMax: f32 = f32(length) * ENERGY_PER_CELL;
    energy = min(energyBase, energyMax);

    lengths[columnIdx] = length;
    speeds[columnIdx] = speed;
  } else {
    // Energy decay
    let halfLife: f32 =
      BASE_HALF_LIFE /
      (1.0 + ENERGY_SPEED_FACTOR * speed) /
      (1.0 + ENERGY_LENGTH_FACTOR * f32(length));

    let lambda: f32 = LN2 / halfLife;
    energy = energy * exp(-lambda * sim.dt);

    let energyMax: f32 = f32(length) * ENERGY_PER_CELL;
    energy = clamp(energy, 0.0, energyMax);
  }

  heads[columnIdx] = head;
  energies[columnIdx] = energy;

  // Emit instances
  let maxLen: u32 = min(length, sim.maxTrail);
  var t: u32 = 0u;

  loop {
    if (t >= maxLen) { break; }

    let idx: u32 = columnIdx * sim.maxTrail + t;

    // compute row position for this trail sample (wrap negative)
    var rowPos: i32 = i32(floor(head)) - i32(t);
    if (rowPos < 0) {
      rowPos = rowPos + i32(sim.rows);
    }

    instances[idx].offset = vec2<f32>(
        f32(columnIdx) * sim.cellWidth,
        f32(rowPos) * sim.cellHeight
    );
    instances[idx].cellSize = vec2<f32>(sim.cellWidth, sim.cellHeight);

    // Glyph selection.
    // Per-sample PRNG: mix column seed with sample index, run one LCG step.
    var gs: u32 = seeds[columnIdx] + t * HASH_MUL;
    gs = gs * LCG_A + LCG_C;
    let glyphIdx: u32 = gs % sim.glyphCount;
    instances[idx].uvRect = glyphUVs[glyphIdx];

    // Brightness
    let x: f32 = select(
      0.0,
      f32(t) / max(1.0, f32(length - 1u)),
      length > 1u
    );

    var brightness: f32 = energy * exp(-TRAIL_DECAY * x);
    if (t == 0u) {
      brightness = brightness * HEAD_BRIGHTNESS_BOOST;
    }

    instances[idx].brightness = brightness;

    t = t + 1u;
  }
}
