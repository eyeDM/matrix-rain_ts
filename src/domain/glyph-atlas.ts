import { GpuResourceScope } from '@backend/resource-tracker';

/** FIXME
 * Resources: Symbol texture atlas
 *
 * Responsibilities:
 * - Render a set of glyphs into an offscreen canvas atlas (offscreen when available)
 * - Upload the atlas to a GPU texture (no per-frame allocations)
 * - Return a sampler and a UV lookup map for each glyph
 */

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

export type AtlasGPUResources = {
    readonly texture: GPUTexture;
    readonly textureView: GPUTextureView;
    readonly sampler: GPUSampler;
    readonly uvBuffer: GPUBuffer; // Storage buffer for compute shader lookups
}

/**
 * All resources needed by the renderer from the atlas generation process.
 */
export interface AtlasResult {
    readonly resources: AtlasGPUResources;
    readonly glyphs: {
        readonly index: Map<string, number>;
        readonly count: number;
        readonly minBindingSize: number;
    };
    readonly layout: {
        readonly atlasWidth: number;
        readonly atlasHeight: number;
        // Final calculated cell dimensions
        readonly cellWidth: number;
        readonly cellHeight: number;
    },
}

// --- CONSTANTS ---

const DEFAULT_FONT_SIZE = 32;
const DEFAULT_PADDING = 8;
const MIN_PADDING = 2;
const DEFAULT_ATLAS_CAP = 8192; // Max size for texture atlas

//export const GLYPH_UV_RECT_SIZE = 4; // vec4<f32> for u0, v0, u1, v1 (components)

/**
 * WGSL-compatible struct:
 *
 * struct GlyphUV {
 *   uv0: vec2<f32>,
 *   uv1: vec2<f32>
 * }
 *
 * => 4 floats
 */
const GLYPH_UV_FLOAT_COUNT = 4;
const FLOAT_SIZE_BYTES = 4;

/**
 * Creates an OffscreenCanvas (or regular canvas fallback) and renders all glyphs
 * into an image atlas, then uploads it to the GPU as a GPUTexture.
 * It also generates the UV coordinates buffer required by the compute shader.
 *
 * @param device - The WebGPU device.
 * @param scope - GPU Resource manager.
 * @param glyphs - Array of strings (single characters) to include in the atlas.
 * @param {Object} options - Configuration options for the atlas.
 * @param {number} [options.cols]
 * @param {number} [options.fontSize=32]
 * @param {string} [options.font='32px monospace']
 * @param {number} [options.padding=8]
 * @param {string} [options.bgFillStyle='transparent']
 * @param {string} [options.fillStyle='white']
 * @returns
 */
export async function createGlyphAtlas(
    device: GPUDevice,
    scope: GpuResourceScope,
    glyphs: readonly string[],
    options: AtlasOptions = {},
): Promise<AtlasResult> {
    if (glyphs.length === 0) {
        throw new Error('Glyph atlas requires at least one glyph');
    }

    const {
        fontSize,
        font,
        padding,
        bgFillStyle,
        fillStyle,
        cols: glyphsPerRow,
    } = normalizeOptions(options, glyphs.length);

    const maxAtlasSize = computeMaxAtlasSize(device);

    const cellSize = measureGlyphs(
        glyphs,
        font,
        padding,
    );

    const grid = computeAtlasLayout({
        glyphCount: glyphs.length,
        cellWidth: cellSize.width,
        cellHeight: cellSize.height,
        maxAtlasSize,
        glyphsPerRow,
    });

    const canvasResult = renderAtlasToCanvas({
        glyphs,
        grid,
        fontSize,
        font,
        bgFillStyle,
        fillStyle,
    });

    const gpuResources = await createGpuResources(
        device,
        scope,
        canvasResult.canvas,
        canvasResult.uvRects,
        grid.width,
        grid.height,
    );

    const glyphIndex = new Map<string, number>();

    for (const [i, glyph] of glyphs.entries()) {
        glyphIndex.set(glyph, i);
    }

    return {
        resources: gpuResources,
        glyphs: {
            index: glyphIndex,
            count: glyphs.length,
            minBindingSize: glyphs.length * GLYPH_UV_FLOAT_COUNT * FLOAT_SIZE_BYTES,
        },
        layout: {
            atlasWidth: grid.width,
            atlasHeight: grid.height,
            cellWidth: cellSize.width,
            cellHeight: cellSize.height,
        },
    }
}

// --- OPTIONS HELPERS ---

function normalizeOptions(options: AtlasOptions, glyphCount: number) {
    const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;

    const font = options.font ?? `${fontSize}px monospace`;

    const padding = Math.max(
        options.padding ?? DEFAULT_PADDING,
        MIN_PADDING,
    );

    const glyphsPerRow = options.cols && options.cols > 0
        ? options.cols
        : Math.floor(Math.sqrt(glyphCount)); // Near-square packing for minimal area

    return {
        fontSize,
        font,
        padding,
        bgFillStyle: options.bgFillStyle ?? 'transparent',
        fillStyle: options.fillStyle ?? 'white',
        cols: glyphsPerRow,
    };
}

// --- LAYOUT ---

type CellSize = {
    readonly width: number;
    readonly height: number;
}

function measureGlyphs(
    glyphs: readonly string[],
    font: string,
    padding: number,
): CellSize {
    const canvas = createCanvas(1, 1);
    const ctx = get2DContext(canvas);

    ctx.font = font;

    let maxWidth = 0;

    for (const glyph of glyphs) {
        const width = ctx.measureText(glyph).width; // physical px
        if (width > maxWidth) {
            maxWidth = width;
        }
    }

    // Measure a representative glyph to determine vertical metrics
    const metrics = ctx.measureText('M');
    const glyphHeight =
        metrics.actualBoundingBoxAscent +
        metrics.actualBoundingBoxDescent;

    const width = Math.ceil(maxWidth) + padding * 2;
    const height = Math.ceil(glyphHeight) + padding * 2;

    return { width, height };
}

type AtlasLayout = {
    readonly cols: number;
    readonly rows: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Compute a safe maximum atlas size based on device limits.
 */
function computeMaxAtlasSize(device: GPUDevice): number {
    return Math.min(device.limits.maxTextureDimension2D, DEFAULT_ATLAS_CAP);
}

function computeAtlasLayout(params: {
    glyphCount: number;
    cellWidth: number;
    cellHeight: number;
    maxAtlasSize: number;
    glyphsPerRow: number;
}): AtlasLayout {
    const {
        glyphCount,
        cellWidth,
        cellHeight,
        maxAtlasSize,
        glyphsPerRow,
    } = params;

    const maxCols = Math.floor(maxAtlasSize / cellWidth);

    if (maxCols <= 0) {
        throw new Error(
            'Cell width exceeds maximum texture dimension.',
        );
    }

    const cols = glyphsPerRow
        ? Math.min(glyphsPerRow, maxCols)
        : Math.min(maxCols, glyphCount);

    const rows = Math.ceil(glyphCount / cols);

    const width = cols * cellWidth;
    const height = rows * cellHeight;

    if (height > maxAtlasSize) {
        throw new Error(
            'Atlas height exceeds maximum texture dimension.',
        );
    }

    return { cols, rows, width, height };
}

// --- CANVAS HELPERS ---

function createCanvas(
    width: number,
    height: number,
): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function get2DContext(
    canvas: OffscreenCanvas | HTMLCanvasElement,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    const ctx = canvas.getContext(
        '2d',
        { alpha: true }
    ) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;

    if (!ctx) {
        throw new Error(
            'Failed to obtain 2D context.',
        );
    }

    return ctx;
}

/**
 * Convert canvas to ImageBitmap - normalize to an ImageBitmap instance.
 */
async function createImageBitmapSafe(
    canvas: OffscreenCanvas | HTMLCanvasElement,
): Promise<ImageBitmap> {
    if (
        'transferToImageBitmap' in canvas
    ) {
        return (
            canvas as OffscreenCanvas
        ).transferToImageBitmap();
    }

    return createImageBitmap(
        canvas as HTMLCanvasElement,
    );
}

type CanvasResult = {
    canvas: OffscreenCanvas | HTMLCanvasElement;
    uvRects: Float32Array;
}

function renderAtlasToCanvas(params: {
    glyphs: readonly string[];
    grid: AtlasLayout;
    fontSize: number;
    font: string;
    bgFillStyle: string;
    fillStyle: string;
}): CanvasResult {
    const {
        glyphs,
        font,
        grid,
        bgFillStyle,
        fillStyle,
    } = params;

    const canvas = createCanvas(
        grid.width,
        grid.height,
    );

    const ctx = get2DContext(canvas);

    ctx.fillStyle = bgFillStyle;
    ctx.fillRect(
        0,
        0,
        grid.width,
        grid.height,
    );

    ctx.font = font;
    ctx.fillStyle = fillStyle;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const uvRects = new Float32Array(
        glyphs.length *
        GLYPH_UV_FLOAT_COUNT,
    );

    const cellWidth = grid.width / grid.cols;
    const cellHeight = grid.height / grid.rows;

    for (const [i, glyph] of glyphs.entries()) {
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);

        const x = col * cellWidth;
        const y = row * cellHeight;

        ctx.fillText(
            glyph,
            x + cellWidth / 2,
            y + cellHeight / 2,
        );

        const u0 = x / grid.width;
        const v0 = y / grid.height;
        const u1 = (x + cellWidth) / grid.width;
        const v1 = (y + cellHeight) / grid.height;

        const offset = i * GLYPH_UV_FLOAT_COUNT;

        uvRects[offset] = u0;
        uvRects[offset + 1] = v0;
        uvRects[offset + 2] = u1;
        uvRects[offset + 3] = v1;
    }

    return { canvas, uvRects };
}

// --- GPU RESOURCES HELPERS ---

async function createGpuResources(
    device: GPUDevice,
    scope: GpuResourceScope,
    canvas: OffscreenCanvas | HTMLCanvasElement,
    uvRects: Float32Array,
    width: number,
    height: number,
): Promise<AtlasGPUResources> {
    // --- Texture Creation and Copy ---

    const texture = scope.trackDestroyable(
        device.createTexture({
            label: 'Glyph Atlas Texture',
            size: { width, height, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
    );

    const bitmap = await createImageBitmapSafe(canvas);

    try {
        // Copy external image to the texture
        device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture },
            [width, height],
        );
    } finally {
        // Release browser resources
        bitmap.close();
    }

    const textureView = texture.createView();
    // Track the view for bookkeeping (not destroyable)
    scope.track(textureView);

    // --- Sampler Creation ---

    const sampler = scope.track(
        device.createSampler({
            label: 'Glyph Atlas Sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        })
    );

    // --- Glyph UV Buffer Creation ---

    const uvBuffer = scope.trackDestroyable(
        device.createBuffer({
            label: 'Glyph UV Storage Buffer',
            size: uvRects.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        }))
    ;

    new Float32Array(
        uvBuffer.getMappedRange()
    ).set(uvRects);

    uvBuffer.unmap();

    return {
        texture,
        textureView,
        sampler,
        uvBuffer,
    };
}
