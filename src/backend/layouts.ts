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
 */

// Unified simulation uniforms
export const SimulationUniformLayout = {
    ALIGN: 4,
    SIZE: 48,
    offsets: {
        dt: 0,                // f32
        rows: 4,              // u32
        cols: 8,              // u32
        glyphCount: 12,       // u32
        cellWidth: 16,        // f32
        cellHeight: 20,       // f32
        maxTrail: 24,         // u32
        // per-frame simulation controls
        time: 28,             // f32
        flickerAmplitude: 32, // f32
        flickerFrequency: 36, // f32
        _pad0: 40,            // f32
        _pad1: 44,            // f32
    },
} as const;

// Instance data layout (storage buffer), one per symbol instance
export const InstanceLayout = {
    ALIGN: 16,
    SIZE: 48,
    offsets: {
        offset: 0,      // vec2<f32> - pixel-space offset of top-left of cell
        cellSize: 8,    // vec2<f32> - pixel size (width, height) of cell
        uvRect: 16,     // vec4<f32> - u0, v0, u1, v1 (normalized atlas UVs)
        brightness: 32, // f32  — final luminance scalar
        _pad0: 36,      // f32
        _pad1: 40,      // f32
        _pad2: 44,      // f32
    },
} as const;

// Canvas size in pixels
export const ScreenLayout = {
    ALIGN: 4,
    SIZE: 16,
    offsets: {
        width: 0,  // f32
        height: 4, // f32
        _pad0: 8,  // f32
        _pad1: 12, // f32
    },
} as const;

// History parameters used by the history accumulation compute shader
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

// Present-stage uniform layout: screen params + time + effect controls
export const PresentUniformLayout = {
    ALIGN: 4,
    SIZE: 48,
    offsets: {
        width: 0,             // f32
        height: 4,            // f32
        time: 8,              // f32
        vignetteStrength: 12, // f32
        scanlineStrength: 16, // f32
        noiseAmplitude: 20,   // f32
        curvature: 24,        // f32
        tintR: 28,            // f32
        tintG: 32,            // f32
        tintB: 36,            // f32
        scanlineFreq: 40,     // f32
        bloomIntensity: 44,   // f32
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
