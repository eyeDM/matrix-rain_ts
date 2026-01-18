// ============================================================================
// Matrix-style column simulation compute shader.
//
// Purpose:
//   This shader is the SINGLE source of truth for the simulation.
//   It updates the per-column state and emits per-symbol instance data
//   entirely on the GPU, with no CPU-side simulation logic.
//
// Core responsibilities:
//   1. Column kinematics:
//      - vertical head position (head)
//      - falling speed (speed)
//      - trail length (length)
//
//   2. Column energy model:
//      - energy is initialized on respawn
//      - energy decays exponentially over time
//      - decay rate increases with column speed and length
//      - energy is clamped by a physically motivated upper bound
//        (energyMax = length * ENERGY_PER_CELL)
//
//   3. Instance generation (per symbol):
//      - symbol position in the grid
//      - cell size
//      - glyph atlas UV coordinates
//      - symbol brightness
//
// Architectural principles:
//   - GPU-first: all simulation runs in a compute pass
//   - Frame-rate independent: all time evolution uses dt
//   - Deterministic per column: PRNG driven by per-column seed
//   - Render pass is completely decoupled from simulation and physics
//
// Respawn logic:
//   When a column head exits the bottom of the screen:
//     - the head position wraps around
//     - the PRNG seed is advanced
//     - column length and speed are re-sampled
//     - column energy is re-initialized
//
// Invariants and guarantees:
//   - length >= LENGTH_MIN (never zero)
//   - 0 <= energy <= energyMax
//   - no division by zero or NaNs
//   - one dispatch corresponds to one simulation step
//
// Performance characteristics:
//   - O(cols * maxTrail)
//   - one exp() per column (energy decay)
//   - one exp() per instance (trail falloff)
//   - no atomics or inter-thread synchronization
//
// ============================================================================`

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
@group(0) @binding(1) var<storage, read> indexes: array<u32>;
@group(0) @binding(2) var<storage, read_write> seeds: array<u32>;
@group(0) @binding(3) var<storage, read_write> heads: array<f32>;
@group(0) @binding(4) var<storage, read_write> speeds: array<f32>;
@group(0) @binding(5) var<storage, read_write> lengths: array<u32>;
@group(0) @binding(6) var<storage, read_write> energies: array<f32>;
@group(0) @binding(7) var<storage, read> glyphUVs: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> instances: array<InstanceData>;

// Linear Congruential Generator constants (32-bit)
const LCG_A: u32 = 1664525u;
const LCG_C: u32 = 1013904223u;

// --- Respawn distribution ---

const LENGTH_MIN: u32 = 3u;
const LENGTH_RANGE: f32 = 20.0;

const SPEED_MIN: f32 = 2.0;
const SPEED_RANGE: f32 = 16.0;

// --- Energy model constants ---

const ENERGY_BASE_MIN: f32 = 4.0;
const ENERGY_BASE_MAX: f32 = 8.0;
const ENERGY_PER_CELL: f32 = 1.25;

const BASE_HALF_LIFE: f32 = 8.0;
const MIN_HALF_LIFE: f32 = 1.0;
const ENERGY_SPEED_FACTOR: f32 = 0.25;
const ENERGY_LENGTH_FACTOR: f32 = 0.05;

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

// --- Hash utilities (PCG-style, stateless) ---

fn hashU32(x: u32) -> u32 {
  var v = x;
  v ^= v >> 16u;
  v *= 0x7feb352du;
  v ^= v >> 15u;
  v *= 0x846ca68bu;
  v ^= v >> 16u;
  return v;
}

fn glyphHash(seed: u32, t: u32) -> u32 {
  // t + 1 to avoid identical hash for head across frames
  return hashU32(seed ^ (t + 1u));
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
    var seed: u32 = seeds[columnIdx];
    seed = seed * LCG_A + LCG_C;
    seeds[columnIdx] = seed;

    // Respawn parameters
    let spawnIntensity: f32 = approxNormal01(seed);

    length = LENGTH_MIN + u32(spawnIntensity * LENGTH_RANGE);  // length in cells
    speed = SPEED_MIN + spawnIntensity * SPEED_RANGE;  // speed (cells/sec)

    let energyBase: f32 =
      ENERGY_BASE_MIN + (ENERGY_BASE_MAX - ENERGY_BASE_MIN) * spawnIntensity;

    let energyMax: f32 = f32(length) * ENERGY_PER_CELL;
    energy = min(energyBase, energyMax);

    lengths[columnIdx] = length;
    speeds[columnIdx] = speed;
  } else {
    // Energy decay
    let halfLife: f32 = max(
      MIN_HALF_LIFE,
      BASE_HALF_LIFE /
      (1.0 + ENERGY_SPEED_FACTOR * speed) /
      (1.0 + ENERGY_LENGTH_FACTOR * f32(length))
    );

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

    // Glyph selection
    let gh: u32 = glyphHash(seeds[columnIdx], t);
    let glyphIdx: u32 = gh % sim.glyphCount;
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
