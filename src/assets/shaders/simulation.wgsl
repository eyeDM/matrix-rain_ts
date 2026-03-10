// ============================================================================
// Compute Shader.
// Updates ColumnState per column.
// ============================================================================

/* --- Data layouts --- */

/* {@see ColumnStateLayout@backend/layouts} */
struct ColumnState {
  seed: u32,
  head: f32,
  length: u32,
  speed: f32,
  energy: f32,
  flicker: f32,

  pad0: u32,
  pad1: u32,
};

/* {@see FrameParamsLayout@backend/layouts} */
struct FrameParams {
  dt: f32,
  time: f32,

  pad0: f32,
  pad1: f32,
};

/* {@see SimulationParamsLayout@backend/layouts} */
struct SimulationParams {
  flickerAmplitude: f32,
  flickerFrequency: f32,
};

/* {@see DrawParamsLayout@backend/layouts} */
struct DrawParams {
  cellSize: vec2<f32>,
  atlasTexelSize: vec2<f32>,
  glyphCount: u32,

  cols: u32,
  rows: u32,
  maxTrail: u32,
};

/* --- RNG --- */

struct RNG {
  base: u32,
  counter: u32,
};

/* --- Constants --- */

const TRAIL_LENGTH_MIN: u32 = 4u;
const TRAIL_LENGTH_VARIANCE: f32 = 20.0;

const SPEED_MIN: f32 = 4.0;
const SPEED_VARIANCE: f32 = 16.0;

const CELL_ENERGY_MIN: f32 = 1.25;
const CELL_ENERGY_VARIANCE: f32 = 2.5;

const HALF_LIFE_MIN: f32 = 1.0;
const HALF_LIFE_BASE: f32 = 8.0;
const ENERGY_SPEED_FACTOR: f32 = 0.25;
const ENERGY_LENGTH_FACTOR: f32 = 0.05;

const LN2: f32 = 0.69314718056;

// Constants for deterministic per-column flicker
const PHASE_MASK: u32 = 0xffffu; // use lower 16 bits of seed
const PHASE_SCALE: f32 = 1.0 / 65536.0; // reciprocal of (PHASE_MASK + 1)
const TWO_PI: f32 = 6.283185307179586;

// PCG hash / Murmur-style mix (stateless, deterministic)
fn hash_u32(x: u32) -> u32 {
  var v = x;
  v ^= v >> 16u;
  v *= 0x7feb352du;
  v ^= v >> 15u;
  v *= 0x846ca68bu;
  v ^= v >> 16u;
  return v;
}

fn rng_init(seed: u32, col: u32, time: f32) -> RNG {
  // decorrelate by column and time (milliseconds scale)
  let t = u32(time * 1000.0);
  let mixed = hash_u32(seed ^ (col * 747796405u) ^ t);
  return RNG(mixed, 0u);
}

fn rng_next(rng: ptr<function, RNG>) -> u32 {
  let value = hash_u32((*rng).base ^ (*rng).counter);
  (*rng).counter += 1u;
  return value;
}

fn rng_next_f32(rng: ptr<function, RNG>) -> f32 {
  return f32(rng_next(rng)) * (1.0 / 4294967296.0);
}

/* --- Simulation --- */

fn change_energy(state: ptr<function, ColumnState>) {
  let halfLife: f32 = max(
    HALF_LIFE_MIN,
    HALF_LIFE_BASE /
    (1.0 + ENERGY_SPEED_FACTOR * (*state).speed) /
    (1.0 + ENERGY_LENGTH_FACTOR * f32((*state).length))
  );

  let lambda: f32 = LN2 / halfLife;
  let energyNew: f32 = (*state).energy * exp(-lambda * frame.dt);

  let energyMax: f32 = CELL_ENERGY_MIN * f32((*state).length) * CELL_ENERGY_VARIANCE;
  (*state).energy = clamp(energyNew, 0.0, energyMax);
}

fn respawn_column(
  state: ptr<function, ColumnState>,
  rng: ptr<function, RNG>
) {
  let r0 = rng_next_f32(rng);
  let r1 = rng_next_f32(rng);
  let r2 = rng_next_f32(rng);
  //let r3 = rng_next_f32(rng);

  (*state).head = 0.0;

  (*state).speed = SPEED_MIN + SPEED_VARIANCE * r0;
  (*state).length = min(
    TRAIL_LENGTH_MIN + u32(TRAIL_LENGTH_VARIANCE * r1),
    grid.maxTrail
  );

  (*state).energy = (CELL_ENERGY_MIN + CELL_ENERGY_VARIANCE * r2) * f32((*state).length);

  (*state).seed = rng_next(rng);
}

@group(0) @binding(0) var<storage, read_write> columns: array<ColumnState>;
@group(0) @binding(1) var<uniform> frame: FrameParams;
@group(0) @binding(2) var<uniform> params: SimulationParams;
@group(0) @binding(3) var<uniform> grid: DrawParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let colIdx: u32 = gid.x;
  if (colIdx >= grid.cols) {
    return;
  }

  var state = columns[colIdx];

  var rng = rng_init(state.seed, colIdx, frame.time);

  // advance head with small jitter to avoid banding
  state.head += state.speed * frame.dt + (rng_next_f32(&rng) - 0.5) * 0.1;

  // respawn condition
  let tail: f32 = state.head - f32(state.length);

  let is_respawn: bool = tail > f32(grid.rows) || state.energy <= 0.0;

  if (is_respawn) {
    respawn_column(&state, &rng);
  } else {
    change_energy(&state);
  }

  // Deterministic per-column flicker: derive a stable phase from the column seed.
  // Use lower 16 bits of seed for a quick phase, map to [0, TWO_PI).
  // NOTE: `frame.time` is periodic [0, 2π), preventing precision loss in long sessions.
  let seedLow = f32(state.seed & PHASE_MASK) * PHASE_SCALE;
  let phase = seedLow * TWO_PI;
  let angular = frame.time * TWO_PI * params.flickerFrequency;
  let flick = sin(angular + phase) * params.flickerAmplitude;

  state.flicker = exp(flick);

  columns[colIdx] = state;
}
