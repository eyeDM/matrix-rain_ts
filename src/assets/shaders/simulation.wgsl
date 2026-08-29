// ============================================================================
// Simulation compute: Per-column state update with deterministic randomness.
//
// PARAMETERS:
//   @binding(0): grid (uniform, GlyphGridParamsLayout)
//     cellSize: Dimensions of each glyph cell in pixels (vec2).
//     atlasTexelSize: Normalized texel size in glyph atlas (vec2).
//     glyphCount: Total number of glyphs in the atlas.
//     cols, rows: Grid dimensions (cell count).
//     minTrail: Minimum trail length in cells.
//     maxTrail: Maximum trail length in cells.
//
//   @binding(1): frame (uniform, FrameParamsLayout)
//     dt: Frame delta time (seconds).
//     time: Total elapsed time (seconds); range [0, 2π) to prevent precision loss.
//
//   @binding(2): params (uniform, SimulationParamsLayout)
//     flickerAmplitude (f32): Peak amplitude of per-column flicker modulation.
//                              Range: [0.0, 1.0] (recommended).
//                              Effect: state.flicker oscillates in [exp(-amplitude), exp(amplitude)].
//     flickerFrequency (f32): Oscillation frequency in cycles per second.
//                              Range: (0.0, ∞); typical [0.5, 5.0].
//                              Effect: modulates phase via sin(time * TWO_PI * frequency + phase).
//
//   @binding(3): columns (storage buffer, read_write, ColumnState[])
//     Per-column simulation state; modified in-place each frame.
//     Each element: seed, head, length, speed, energy, flicker.
//
// ALGORITHM (per invocation = per column):
//   1. Validate column index; exit if out of bounds.
//   2. Load column state.
//   3. Initialize RNG with column seed, index, and current time.
//   4. Advance head position:
//        head += speed * dt + jitter
//   5. Compute tail position:
//        tail = head - length
//   6. Check respawn condition (tail exceeds rows OR energy depleted):
//      - If true: respawn (reset head, speed, length, energy, reseed).
//      - If false: apply exponential energy decay based on speed/length.
//   7. Compute deterministic flicker:
//        phase = (seed_low_bits * TWO_PI)
//        flicker = exp(sin(time * TWO_PI * frequency + phase) * amplitude)
//   8. Write updated state back to buffer.
//
// OUTPUT:
//   @binding(3): columns[] (modified in-place)
//     Updated per-column state:
//       head: New position along vertical axis (may exceed rows; wraps in DrawPass).
//       energy: Decayed or respawned.
//       flicker: Computed oscillation value.
//       seed: Reseeded if respawned; unchanged if decaying.
//       speed, length: Unchanged if decaying; resampled if respawned.
//
// ============================================================================

/* --- Data layouts --- */

/* {@see GlyphGridParamsLayout@backend/layouts} */
struct GlyphGridParams {
  cellSize: vec2<f32>,
  atlasTexelSize: vec2<f32>,
  glyphCount: u32,

  cols: u32,
  rows: u32,

  minTrail: u32,
  maxTrail: u32,
};

/* {@see FrameParamsLayout@backend/layouts} */
struct FrameParams {
  dt: f32,
  time: f32,
};

/* {@see SimulationParamsLayout@backend/layouts} */
struct SimulationParams {
  flickerAmplitude: f32,
  flickerFrequency: f32,
};

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

/* --- RNG --- */

struct RNG {
  base: u32,
  counter: u32,
};

/* --- Constants --- */

const SPEED_MIN: f32 = 4.0;
const SPEED_LIMIT: f32 = 20.0;
const SPEED_RANGE: f32 = SPEED_LIMIT - SPEED_MIN;

const CELL_ENERGY_MIN: f32 = 1.25;
const CELL_ENERGY_LIMIT: f32 = 3.75;
const CELL_ENERGY_RANGE: f32 = CELL_ENERGY_LIMIT - CELL_ENERGY_MIN;

const HALF_LIFE_MIN: f32 = 1.0;
const HALF_LIFE_BASE: f32 = 8.0;
const ENERGY_SPEED_FACTOR: f32 = 0.25;
const ENERGY_LENGTH_FACTOR: f32 = 0.05;

const LN2: f32 = 0.69314718056;

// Constants for deterministic per-column flicker
const PHASE_MASK: u32 = 0xffffu; // use lower 16 bits of seed
const PHASE_SCALE: f32 = 1.0 / 65536.0; // reciprocal of (PHASE_MASK + 1)
const TWO_PI: f32 = 6.283185307179586;

// Stateless 32-bit integer hash
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
  // Keep 24 random bits, which are represented exactly by f32.
  return f32(rng_next(rng) >> 8u) * (1.0 / 16777216.0);
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
  let energyMax: f32 = CELL_ENERGY_LIMIT * f32((*state).length);

  (*state).energy = clamp(energyNew, 0.0, energyMax);
}

fn respawn_column(
  state: ptr<function, ColumnState>,
  rng: ptr<function, RNG>
) {
  let r0 = rng_next_f32(rng);
  let r1 = rng_next_f32(rng);
  let r2 = rng_next_f32(rng);

  (*state).head = 0.0;

  (*state).speed = SPEED_MIN + SPEED_RANGE * r0;

  let trailLengthCount = grid.maxTrail - grid.minTrail + 1u;

  (*state).length = grid.minTrail + u32(f32(trailLengthCount) * r1);

  let energyPerCell = CELL_ENERGY_MIN + CELL_ENERGY_RANGE * r2;

  (*state).energy = energyPerCell * f32((*state).length);

  (*state).seed = rng_next(rng);
}

@group(0) @binding(0) var<uniform> grid: GlyphGridParams;
@group(0) @binding(1) var<uniform> frame: FrameParams;
@group(0) @binding(2) var<uniform> params: SimulationParams;
@group(0) @binding(3) var<storage, read_write> columns: array<ColumnState>;

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
