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

// Unified render params
export const DrawParamsLayout = {
    ALIGN: 16,
    SIZE: 48,
    offsets: {
        canvasSize: 0,        // vec2<f32>
        cellSize: 8,          // vec2<f32>

        cols: 16,             // u32
        rows: 20,             // u32
        maxTrail: 24,         // u32
        glyphCount: 28,       // u32

        flickerAmplitude: 32, // f32
        flickerFrequency: 36, // f32

        dt: 40,               // f32
        time: 44,             // f32
    },
} as const;

// One instance per column
export const ColumnStateLayout = {
    ALIGN: 4,
    SIZE: 32,
    offsets: {
        head: 0,    // f32
        speed: 4,   // f32
        energy: 8,  // f32
        length: 12, // u32
        seed: 16,   // u32
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

// Blur params for separable Gaussian blur (direction and texel size + threshold)
export const BlurParamsLayout = {
    ALIGN: 4,
    SIZE: 16,
    offsets: {
        dirX: 0,       // f32
        dirY: 4,       // f32
        texelSize: 8,  // f32
        threshold: 12, // f32
    },
} as const;

// Present-stage uniform layout: screen params + time + effect controls
export const PresentParamsLayout = {
    ALIGN: 4,
    SIZE: 48,
    offsets: {
        time: 0,              // f32
        vignetteStrength: 4,  // f32
        scanlineFreq: 8,      // f32
        scanlineStrength: 12, // f32
        noiseAmplitude: 16,   // f32
        curvature: 20,        // f32
        tintR: 24,            // f32
        tintG: 28,            // f32
        tintB: 32,            // f32
        bloomIntensity: 36,   // f32
        _pad0: 40,            // f32
        _pad1: 44,            // f32
    },
} as const;
