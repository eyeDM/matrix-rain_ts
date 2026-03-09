/**
 * Canonical CPU ↔ GPU memory layout contracts.
 * This file is the ONLY place allowed to define buffer sizes, offsets, and alignment.
 *
 * WGSL structs MUST mirror these layouts exactly.
 *
 * Alignment rules (WGSL / std140-like):
 * - f32, i32, u32: 4
 * - vec2<f32>: 8
 * - vec3<f32>: 16 (size 12 + padding)
 * - vec4<f32>: 16
 * - struct alignment = max field alignment
 * - struct size = padded to struct alignment
 *
 * Size is in bytes.
 */

// On screen resize writing
export const ViewportParamsLayout = {
    ALIGN: 4,
    SIZE: 16,
    offsets: {
        width: 0,   // u32
        height: 4,  // u32
        _pad0: 8,   // u32
        _pad1: 12,  // u32
    },
};

// Per-frame writing
export const FrameParamsLayout = {
    ALIGN: 4,
    SIZE: 16,
    offsets: {
        dt: 0,     // f32: delta; seconds
        time: 4,   // f32: periodic time wrapped to [0, 2π) - guarantees f32 precision; seconds
        _pad0: 8,  // f32
        _pad1: 12, // f32
    },
};

// Unified render params
export const DrawParamsLayout = {
    ALIGN: 8,
    SIZE: 48,
    offsets: {
        cellSize: 0,          // vec2<f32>: pixels
        atlasTexelSize: 8,    // vec2<f32>: in atlas UV space (1/width, 1/height)

        cols: 16,             // u32
        rows: 20,             // u32
        maxTrail: 24,         // u32

        glyphCount: 28,       // u32

        flickerAmplitude: 32, // f32
        flickerFrequency: 36, // f32: Hz

        _pad0: 40,  // f32
        _pad1: 44, // f32
    },
} as const;

// One instance per column
export const ColumnStateLayout = {
    ALIGN: 4,
    SIZE: 32,
    offsets: {
        head: 0,    // f32: head position in row-space (y)
        speed: 4,   // f32: cells per second
        energy: 8,  // f32: determines brightness
        length: 12, // u32: trail length in cells
        seed: 16,   // u32: deterministic seed
        _pad0: 20,  // u32
        _pad1: 24,  // u32
        _pad2: 28,  // u32
    },
} as const;

// History params used by the history accumulation compute shader
export const HistoryParamsLayout = {
    ALIGN: 4,
    SIZE: 16,
    offsets: {
        decay: 0,  // f32
        _pad0: 4,  // f32
        _pad1: 8,  // f32
        _pad2: 12, // f32
    },
} as const;

// Blur params for separable Gaussian blur (direction + texel size)
export const BlurParamsLayout = {
    ALIGN: 4,
    SIZE: 16,
    offsets: {
        dirX: 0,      // f32
        dirY: 4,      // f32
        texelSize: 8, // f32
        _pad0: 12,    // f32
    },
} as const;

// Present-stage uniform layout: screen params + time + effect controls
export const PresentParamsLayout = {
    ALIGN: 4,
    SIZE: 48,
    offsets: {
        vignetteStrength: 0, // f32
        scanlineFreq: 4,     // f32
        scanlineStrength: 8, // f32
        noiseAmplitude: 12,  // f32
        curvature: 16,       // f32
        tintR: 20,           // f32
        tintG: 24,           // f32
        tintB: 28,           // f32
        bloomIntensity: 32,  // f32
        _pad0: 36,           // f32
        _pad1: 40,           // f32
        _pad2: 44,           // f32
    },
} as const;
