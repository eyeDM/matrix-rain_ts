/**
 * Canonical CPU ↔ GPU memory layout contracts.
 * This file is the ONLY place allowed to define buffer sizes, offsets, and alignment.
 *
 * WGSL structs MUST mirror these layouts exactly.
 *
 * Alignment rules (WGSL / std140-like):
 * - f32 / u32: 4
 * - vec2<f32>: 8
 * - vec3<f32>: 16 (size 12 + padding)
 * - vec4<f32>: 16
 * - struct alignment = max field alignment
 * - struct size = padded to struct alignment
 */

// Unified simulation uniforms.
export const SimulationUniformLayout = {
    ALIGN: 16,
    SIZE: 32,
    offsets: {
        dt: 0,           // f32
        rows: 4,         // u32
        cols: 8,         // u32
        glyphCount: 12,  // u32
        cellWidth: 16,   // f32
        cellHeight: 20,  // f32
        maxTrail: 24,    // u32
        _pad0: 28,       // u32 (explicit padding to 32 bytes)
    },
} as const;

export const InstanceLayout = {
    ALIGN: 16,
    SIZE: 48,
    offsets: {
        offset: 0,       // vec2<f32> - pixel-space offset of top-left of cell
        cellSize: 8,     // vec2<f32> - pixel size (width, height) of cell
        uvRect: 16,      // vec4<f32> - u0, v0, u1, v1 (normalized atlas UVs)
        brightness: 32,  // f32  — final luminance scalar
        _pad0: 36,       // vec3<f32>  — explicit padding
    },
} as const;

// Canvas size in pixels
export const ScreenLayout = {
    ALIGN: 16,
    SIZE: 16,
    offsets: {
        width: 0,  // f32
        height: 4, // f32
        _pad0: 8,  // vec2<f32>
    },
} as const;
