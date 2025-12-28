import { InstanceLayout } from '@platform/webgpu/layouts';

/**
 * Resources: Symbol texture atlas
 *
 * Responsibilities:
 * - Render a set of glyphs into an offscreen canvas atlas (offscreen when available)
 * - Upload the atlas to a GPU texture (no per-frame allocations)
 * - Return a sampler and a UV lookup map for each glyph
 *
 * Return shape (Stage 3 acceptance):
 * {
 *   texture: GPUTexture,
 *   sampler: GPUSampler,
 *   glyphMap: Map<string, UVRect>
 * }
 */

/**
 * UVRect: Normalized UV coordinates and pixel dimensions of a single glyph cell.
 */
export type UVRect = {
    // UV coordinates in normalized [0,1] texture space
    u0: number;
    v0: number;
    u1: number;
    v1: number;
    // pixel size of the glyph cell inside the atlas
    width: number;
    height: number;
};

/**
 * AtlasResult: All resources needed by the renderer from the atlas generation process.
 */
export type AtlasResult = {
    texture: GPUTexture;
    sampler: GPUSampler;
    glyphMap: Map<string, UVRect>;
    glyphUVsBuffer: GPUBuffer; // Storage buffer for compute shader lookups
    cellWidth: number; // Final calculated cell dimensions
    cellHeight: number;
};

/**
 * AtlasOptions: Configuration for the glyph atlas rendering.
 */
export type AtlasOptions = {
    font?: string; // CSS font string, e.g. '24px monospace'
    fontSize?: number; // fallback font size in px
    padding?: number; // padding around glyphs in pixels
    cols?: number; // optional fixed number of columns for atlas layout
    bgFillStyle?: string; // background fill for atlas, default transparent
    fillStyle?: string; // glyph color when drawing onto the atlas
};

// --- CONSTANTS ---
const DEFAULT_ATLAS_CAP = 8192; // Max size for texture atlas
const MIN_PADDING = 2;
const GLYPH_UV_RECT_SIZE = 4; // vec4<f32> for u0, v0, u1, v1

/**
 * Compute a safe maximum atlas size based on device limits.
 */
function computeMaxAtlasSize(device: GPUDevice): number {
    return Math.min(device.limits.maxTextureDimension2D, DEFAULT_ATLAS_CAP);
}

/**
 * Compute adaptive padding to ensure sufficient column count.
 */
function computeAdaptivePadding(
    basePadding: number,
    glyphCount: number,
    cellContentWidth: number,
    maxAtlasSize: number,
): number {
    let padding = basePadding;

    while (padding > MIN_PADDING) {
        const cellWidth = Math.ceil(cellContentWidth) + padding * 2;
        const cols = Math.floor(maxAtlasSize / cellWidth);

        if (cols > 0 && cols * Math.ceil(glyphCount / cols) * cellWidth <= maxAtlasSize) {
            break;
        }

        padding--;
    }

    return padding;
}

/**
 * Creates an OffscreenCanvas (or regular canvas fallback) and renders all glyphs
 * into an image atlas, then uploads it to the GPU as a GPUTexture.
 * It also generates the UV coordinates buffer required by the compute shader.
 *
 * @param device - The WebGPU device.
 * @param glyphs - Array of strings (single characters) to include in the atlas.
 * @param {Object} options - Configuration options for the atlas.
 * @param {number} [options.cols]
 * @param {number} [options.fontSize=32]
 * @param {string} [options.font='36px monospace']
 * @param {number} [options.padding=8]
 * @param {string} [options.bgFillStyle='transparent']
 * @param {string} [options.fillStyle='white']
 * @returns All necessary GPU and metadata resources.
 */
export async function createGlyphAtlas(
    device: GPUDevice,
    glyphs: string[],
    options: AtlasOptions = {},
): Promise<AtlasResult> {
    // --- 1. Canvas Setup and Measurement ---

    const FONT_SIZE = options.fontSize ?? 32;
    const FONT = options.font ?? `${FONT_SIZE}px monospace`;
    const BASE_PADDING = options.padding ?? 8;

    const ATLAS_MAX_SIZE = computeMaxAtlasSize(device);

    const canUseOffscreen = typeof OffscreenCanvas !== 'undefined';

    const tempCanvas = canUseOffscreen
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');

    const ctx = tempCanvas.getContext('2d', { alpha: true }) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;

    if (!ctx) {
        throw new Error('Failed to get 2D canvas context for atlas generation.');
    }

    ctx.font = FONT;

    // --- Measure glyphs ---
    let maxGlyphWidth = 0;

    for (const ch of glyphs) {
        const w = ctx.measureText(ch).width; // physical px
        if (w > maxGlyphWidth) maxGlyphWidth = w;
    }

    // Adaptive padding calculation
    const PADDING = computeAdaptivePadding(
        BASE_PADDING,
        glyphs.length,
        maxGlyphWidth,
        ATLAS_MAX_SIZE,
    );

    // Calculate cell dimensions based on the first glyph
    const cellWidth = Math.ceil(maxGlyphWidth) + PADDING * 2;
    const cellHeight = FONT_SIZE + PADDING * 2;

    // --- 2. Minimal Atlas Layout Calculation ---

    const glyphsPerRow = options.cols && options.cols > 0
        ? options.cols
        : Math.floor(Math.sqrt(glyphs.length)); // Near-square packing for minimal area

    const totalRows = Math.ceil(glyphs.length / glyphsPerRow);

    const atlasWidth = glyphsPerRow * cellWidth;
    const atlasHeight = totalRows * cellHeight;

    if (atlasWidth > ATLAS_MAX_SIZE || atlasHeight > ATLAS_MAX_SIZE) {
        throw new Error(
            `Atlas size ${atlasWidth}x${atlasHeight} exceeds device limit ${ATLAS_MAX_SIZE}`,
        );
    }

    // Final canvas sizing
    tempCanvas.width = atlasWidth;
    tempCanvas.height = atlasHeight;

    // --- 3. Glyph Drawing and UV Mapping ---

    const glyphMap = new Map<string, UVRect>();
    const uvRects = new Float32Array(glyphs.length * GLYPH_UV_RECT_SIZE); // u0, v0, u1, v1

    // Clear canvas
    ctx.fillStyle = options.bgFillStyle ?? 'transparent';
    ctx.fillRect(0, 0, atlasWidth, atlasHeight);

    // Set drawing styles
    ctx.fillStyle = options.fillStyle ?? 'white'; // Draw white, the shader applies green
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = FONT;

    // Draw all glyphs
    for (const [i, glyph] of glyphs.entries()) {
        const col = i % glyphsPerRow;
        const row = Math.floor(i / glyphsPerRow);

        const x = col * cellWidth;
        const y = row * cellHeight;

        // Draw glyph centered in the cell
        const drawX = x + cellWidth / 2;
        const drawY = y + cellHeight / 2;
        ctx.fillText(glyph, drawX, drawY);

        // Calculate normalized UV rects
        const u0 = x / atlasWidth;
        const v0 = y / atlasHeight;
        const u1 = (x + cellWidth) / atlasWidth;
        const v1 = (y + cellHeight) / atlasHeight;

        glyphMap.set(glyph, {
            u0,
            v0,
            u1,
            v1,
            width: cellWidth,
            height: cellHeight,
        });

        const bufferOffset = i * GLYPH_UV_RECT_SIZE;
        uvRects[bufferOffset] = u0;
        uvRects[bufferOffset + 1] = v0;
        uvRects[bufferOffset + 2] = u1;
        uvRects[bufferOffset + 3] = v1;
    }

    // --- 4. GPU Texture Creation and Copy ---

    const texture = device.createTexture({
        size: { width: atlasWidth, height: atlasHeight, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        label: 'Glyph Atlas Texture',
    });

    // Convert canvas to ImageBitmap
    const bitmap = canUseOffscreen && (tempCanvas as OffscreenCanvas).transferToImageBitmap
        ? (tempCanvas as OffscreenCanvas).transferToImageBitmap()
        : await createImageBitmap(tempCanvas as HTMLCanvasElement);

    // Copy external image to the texture
    try {
        device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture },
            [atlasWidth, atlasHeight],
        );
    } finally {
        // Release browser resources
        try { bitmap.close(); } catch (e) { /* ignore */ }
    }

    // --- 5. Sampler Creation ---

    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        label: 'Glyph Atlas Sampler',
    });

    // --- 6. Glyph UV Buffer Creation ---

    const glyphUVsBuffer = device.createBuffer({
        size: uvRects.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Glyph UV Storage Buffer',
        mappedAtCreation: true,
    });

    new Float32Array(glyphUVsBuffer.getMappedRange()).set(uvRects);
    glyphUVsBuffer.unmap();

    // --- 7. Return Result ---

    return {
        texture,
        sampler,
        glyphMap,
        glyphUVsBuffer,
        cellWidth,
        cellHeight,
    };
}

/**
 * Create a GPU buffer specifically for holding instance data (InstanceData[] in WGSL).
 * This buffer acts as the output target for the Compute Shader and the input source
 * for the Render (Draw) Shader.
 *
 * @param device - The WebGPU device.
 * @param instanceCount - Total number of symbol instances to allocate space for (cols * maxTrail).
 * @returns The initialized GPUBuffer.
 */
export function createInstanceBuffer(device: GPUDevice, instanceCount: number): GPUBuffer {
    // Ensure minimum buffer size to avoid WebGPU validation errors if instanceCount is 0
    const size = Math.max(4, instanceCount * InstanceLayout.SIZE);

    // Must be STORAGE for compute (output) and STORAGE for render (input)
    return device.createBuffer({
        size: size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Matrix Instance Data Buffer',
    });
}
