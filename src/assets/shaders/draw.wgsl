// ============================================================================
// Matrix-style procedural render shader.
// ============================================================================

/* --- Data layouts --- */

/* {@see TimeParamsLayout@backend/layouts} */
struct TimeParams {
  dt: f32,
  pt: f32,

  pad0: f32,
  pad1: f32,
};

/* {@see DrawParamsLayout@backend/layouts} */
struct DrawParams {
  cellSize: vec2<f32>,
  atlasTexelSize: vec2<f32>,

  canvasSize: vec2<f32>,
  cols: u32,
  rows: u32,
  maxTrail: u32,

  glyphCount: u32,

  flickerAmplitude: f32,
  flickerFrequency: f32,
};

/* {@see ColumnStateLayout@backend/layouts} */
struct ColumnState {
  head: f32,
  speed: f32,
  energy: f32,
  length: u32,
  seed: u32,

  pad0: u32,
  pad1: u32,
  pad2: u32,
};

/* {@see GLYPH_UV_FLOAT_COUNT@domain/glyph-atlas} */
struct GlyphUV {
  uv0: vec2<f32>,
  uv1: vec2<f32>,
};

/* --- Constants (must match simulation) --- */

const HEAD_BRIGHTNESS_BOOST: f32 = 1.15;

// Constants for deterministic per-column flicker
const PHASE_MASK: u32 = 0xffffu; // use lower 16 bits of seed
const PHASE_SCALE: f32 = 1.0 / 65536.0; // reciprocal of (PHASE_MASK + 1)
const TWO_PI: f32 = 6.283185307179586;

const BLOOM_THRESHOLD: f32 = 1.2;

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

@group(0) @binding(0) var atlasSampler: sampler;
@group(0) @binding(1) var atlasTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> glyphUVs: array<GlyphUV>;
@group(0) @binding(3) var<storage, read> columns: array<ColumnState>;
@group(0) @binding(4) var<uniform> time: TimeParams;
@group(0) @binding(5) var<uniform> params: DrawParams;

struct VSOut {
  @builtin(position) Position: vec4<f32>,
  @location(0) v_uv: vec2<f32>,
  @location(1) v_brightness_ldr: f32,
  @location(2) v_brightness_hdr: f32,
  @location(3) v_brightness_alpha: f32,
};

@vertex
fn vs_main(
  @location(0) pos: vec2<f32>,
  @location(1) uv: vec2<f32>,
  @builtin(instance_index) instanceIdx: u32
) -> VSOut {

  var out: VSOut;

  /* --- Instance → (colIdx, cellIdx) --- */

  let colIdx: u32 = instanceIdx % params.cols;
  let cellIdx: u32 = instanceIdx / params.cols;

  let column = columns[colIdx];

  /* --- Reject nonexistent trail segments --- */

  if (
    cellIdx >= column.length
    || cellIdx > u32(column.head) // segments that are even "higher" than the head
  ) {
    // Push outside clip space
    out.Position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
    out.v_uv = vec2<f32>(0.0);
    out.v_brightness_ldr = 0.0;
    out.v_brightness_hdr = 0.0;
    out.v_brightness_alpha = 0.0;
    return out;
  }

  /* --- Compute row (wrap vertically) --- */

  let headRow = i32(floor(column.head));
  var row = headRow - i32(cellIdx);

  if (row < 0) {
    row += i32(params.rows);
  }

  /* --- Pixel-space position --- */

  let pixelOffset = vec2<f32>(
    f32(colIdx) * params.cellSize.x,
    f32(row)    * params.cellSize.y
  );

  let pixelPos = pixelOffset + (pos + vec2<f32>(0.5, 0.5)) * params.cellSize;

  /* --- Pixel → NDC --- */

  // Convert pixel space to NDC
  let ndcX = (pixelPos.x / params.canvasSize.x) * 2.0 - 1.0;
  // flip Y because texture/canvas origin is top-left
  let ndcY = 1.0 - (pixelPos.y / params.canvasSize.y) * 2.0;

  out.Position = vec4<f32>(ndcX, ndcY, 0.0, 1.0);

  /* --- Glyph selection --- */

  let gh = hash_u32(column.seed ^ (cellIdx + 1u));
  let glyphIdx = gh % params.glyphCount;
  let glyphUV = glyphUVs[glyphIdx];

  // safe inset (sub-texel safe zone)
  let inset = params.atlasTexelSize * 0.75;

  // interpolate inside cell
  let rawUV = glyphUV.uv0 + uv * (glyphUV.uv1 - glyphUV.uv0);

  // clamp to avoid bleeding
  out.v_uv = clamp(
    rawUV,
    glyphUV.uv0 + inset,
    glyphUV.uv1 - inset
  );

  /* --- Brightness --- */

  let len = f32(column.length);

  // avoid division by zero for single-cell trails
  let denom = max(len - 1.0, 1.0);

  let cellPos = select(
    0.0,
    f32(cellIdx) / denom,
    column.length > 1u
  );

  // 1. weight along trail (parabolic falloff)
  let p = 2.4;
  let w = pow(1.0 - cellPos, p);

  // 2. improved discrete normalization (Euler–Maclaurin)
  let norm = select(
    1.0, // length == 1
    (len + 1.0) / (p + 1.0),
    column.length > 1u
  );

  // 3. energy per cell
  let Ecell = column.energy * w / norm;

  // 4. map energy -> brightness (soft saturation)
  let k = 1.6;
  var brightnessLDR = 1.0 - exp(-k * Ecell);

  // 5. ensure head dominance
  let headClamp = 0.18;
  brightnessLDR *= (1.0 - headClamp * cellPos);

  // head boost
  if (cellIdx == 0u) {
    brightnessLDR *= HEAD_BRIGHTNESS_BOOST;
  }

  // Deterministic per-column flicker: derive a stable phase from the column seed.
  // Use lower 16 bits of seed for a quick phase, map to [0, TWO_PI).
  // NOTE: time.pt is periodic [0, 2π), preventing precision loss in long sessions.
  let seedLow = f32(column.seed & PHASE_MASK) * PHASE_SCALE;
  let phase = seedLow * TWO_PI;
  let angular = time.pt * params.flickerFrequency;
  let flick = sin(angular + phase) * params.flickerAmplitude;

  out.v_brightness_ldr = max(0.0, brightnessLDR * (1.0 + flick));
  out.v_brightness_hdr = max(0.0, Ecell * (1.0 + flick));
  out.v_brightness_alpha = brightnessLDR;
  return out;
}

struct FSOut {
  @location(0) color: vec4<f32>,
  @location(1) bright: vec4<f32>,
};

@fragment
fn fs_main(in: VSOut) -> FSOut {
  // Bright green base
  let baseColor = vec3<f32>(0.0, 1.0, 0.0);

  // Glyph alpha (atlas assumed monochrome in alpha)
  let glyphAlpha = textureSample(atlasTexture, atlasSampler, in.v_uv).a;

  // Mix the color with the sampled glyph visibility
  let color = baseColor * in.v_brightness_ldr;
  let hdrColor = baseColor * in.v_brightness_hdr;
  let alpha = glyphAlpha * in.v_brightness_alpha;

  // Extract only the "bright" part
  let brightColor = max(hdrColor - vec3<f32>(BLOOM_THRESHOLD), vec3<f32>(0.0));

  var out: FSOut;
  out.color = vec4<f32>(color, alpha);
  out.bright = vec4<f32>(brightColor * glyphAlpha, glyphAlpha);
  return out;
}
