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

export type AtlasResult = {
  texture: GPUTexture;
  sampler: GPUSampler;
  glyphMap: Map<string, UVRect>;
};

export type AtlasOptions = {
  font?: string; // CSS font string, e.g. '24px monospace'
  fontSize?: number; // fallback font size in px
  padding?: number; // padding around glyphs in pixels
  cols?: number; // optional fixed number of columns
  bgFillStyle?: string; // background fill for atlas, default transparent
  fillStyle?: string; // glyph color when drawing onto the atlas (ignored for shader colorization)
};

/**
 * Create a GPU-backed glyph atlas by rendering glyphs to an offscreen canvas.
 *
 * Implementation notes / constraints:
 * - Uses OffscreenCanvas when available for worker-friendly, GPU-safe rendering.
 * - Produces an atlas texture with format `rgba8unorm` and usage `TEXTURE_BINDING | COPY_DST`.
 * - Uploads via `device.queue.copyExternalImageToTexture` using an ImageBitmap (fast path).
 * - Documents atlas layout: grid with fixed cellWidth x cellHeight. UVs map to full cells.
 *
 * The function intentionally avoids any per-frame allocations; it's intended to be called during init.
 */
export async function createGlyphAtlas(
  device: GPUDevice,
  glyphs: string[],
  options?: AtlasOptions
): Promise<AtlasResult> {
  const opts: Required<AtlasOptions> = {
    font: options?.font ?? '24px monospace',
    fontSize: options?.fontSize ?? 24,
    padding: options?.padding ?? 4,
    cols: options?.cols ?? 0,
    bgFillStyle: options?.bgFillStyle ?? 'transparent',
    fillStyle: options?.fillStyle ?? '#ffffff'
  };

  // Determine cell size by measuring a representative glyph using a temporary 2D context.
  // We create a tiny canvas for measurement only.
  const measureCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!measureCtx) throw new Error('2D context unavailable for glyph measurement');
  measureCtx.font = opts.font;

  // Measure max glyph width/height
  let maxW = 0;
  let maxH = opts.fontSize;
  for (const g of glyphs) {
    const metrics = measureCtx.measureText(g);
    const w = Math.ceil(metrics.width);
    if (w > maxW) maxW = w;
    // height estimate: use fontSize as conservative height
  }

  const cellW = maxW + opts.padding * 2;
  const cellH = Math.ceil(maxH + opts.padding * 2);

  // Grid layout
  const count = glyphs.length;
  const cols = opts.cols > 0 ? opts.cols : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const atlasWidth = cols * cellW;
  const atlasHeight = rows * cellH;

  // Create drawing canvas (offscreen when available)
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(atlasWidth, atlasHeight);
  } else {
    const el = document.createElement('canvas');
    el.width = atlasWidth;
    el.height = atlasHeight;
    canvas = el;
  }

  const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Failed to get 2D context for atlas rendering');

  // Clear / background
  ctx.fillStyle = opts.bgFillStyle;
  ctx.fillRect(0, 0, atlasWidth, atlasHeight);

  ctx.font = opts.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = opts.fillStyle; // white glyphs by default

  const glyphMap = new Map<string, UVRect>();

  // Layout and draw glyphs into grid cells
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cellW + cellW / 2; // center of cell
    const y = row * cellH + cellH / 2; // center of cell

    // Draw glyph centered in its cell
    ctx.fillText(g, x, y);

    // UV mapping uses the full cell to simplify lookup in shader.
    const u0 = (col * cellW) / atlasWidth;
    const v0 = (row * cellH) / atlasHeight;
    const u1 = ((col + 1) * cellW) / atlasWidth;
    const v1 = ((row + 1) * cellH) / atlasHeight;

    glyphMap.set(g, { u0, v0, u1, v1, width: cellW, height: cellH });
  }

  // Create GPU texture and upload atlas
  const texture = device.createTexture({
    size: [atlasWidth, atlasHeight, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });

  // Create an ImageBitmap from the canvas (fast path) and copy to GPU texture
  let bitmap: ImageBitmap;
  if (typeof (canvas as OffscreenCanvas).transferToImageBitmap === 'function') {
    // OffscreenCanvas fast path
    // @ts-ignore - type narrowing for OffscreenCanvas
    bitmap = (canvas as OffscreenCanvas).transferToImageBitmap();
  } else {
    // HTMLElement canvas path
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore createImageBitmap is available globally in browser contexts
    bitmap = await createImageBitmap(canvas as HTMLCanvasElement);
  }

  // Copy external image to the texture
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    [atlasWidth, atlasHeight]
  );

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge'
  });

  return { texture, sampler, glyphMap };
}
