// Bootstrap entry — initialize WebGPU
import { WebGPUInitExtended, initWebGPU } from './boot/webgpu-init';
import { startRenderLoop } from './engine/render-loop';
import { createGlyphAtlas, createInstanceBuffer } from './engine/resources';
import { Renderer, createRenderer } from './engine/renderer';
import { RenderGraph, createRenderGraph } from './engine/render-graph';
import { createResourceManager } from './engine/resource-manager';

/**
 * Immutable grid layout derived from canvas size.
 */
type GridLayout = {
    cols: number;
    rows: number;
    maxTrail: number;
    instanceCount: number;
};

/**
 * Authoritative runtime state container.
 */
type AppState = {
    gpu: WebGPUInitExtended;
    renderer: Renderer;
    instances: GPUBuffer;
    renderGraph: RenderGraph;
    layout: GridLayout;
};

/**
 * Compute grid layout from physical canvas size.
 * This function is PURE and side-effect free.
 */
function computeGridLayout(
    canvasWidth: number,
    canvasHeight: number,
    devicePixelRatio: number,
    cellWidth: number,
    cellHeight: number,
): GridLayout {
    const widthCSS = canvasWidth * devicePixelRatio;
    const heightCSS = canvasHeight * devicePixelRatio;

    const cols = Math.floor(widthCSS / cellWidth);
    const rows = Math.ceil(heightCSS / cellHeight);

    const MIN_TRAIL = 4;
    const maxTrail = Math.max(MIN_TRAIL, rows);

    return {
        cols,
        rows,
        maxTrail,
        instanceCount: cols * maxTrail,
    };
}

/**
 * Create renderer + buffers + render graph as a single disposable unit.
 */
async function createRenderBundle(
    device: GPUDevice,
    layout: GridLayout,
    atlas: Awaited<ReturnType<typeof createGlyphAtlas>>,
    glyphCount: number,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
): Promise<{ renderer: Renderer; instances: GPUBuffer; graph: RenderGraph }> {
    const instances = createInstanceBuffer(device, layout.instanceCount);

    const renderer = await createRenderer(
        device,
        layout.cols,
        layout.rows,
        layout.maxTrail,
        atlas.glyphUVsBuffer,
        instances,
        layout.instanceCount,
        glyphCount,
        atlas.cellWidth,
        atlas.cellHeight,
        atlas.texture,
        atlas.sampler,
        canvas,
        format,
    );

    const graph = createRenderGraph();
    graph.addPass(renderer.computePass);
    graph.addPass(renderer.drawPass);

    return { renderer, instances, graph };
}

export async function bootstrap(): Promise<void> {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('Canvas element `#canvas` not found');

    const gpu = await initWebGPU(canvas);

    // Resource manager for long-lived resources (glyph atlas, samplers)
    const persistentRM = createResourceManager(gpu.device);

    //const { device, context, format, configureCanvas } = await initWebGPU(canvasEl);

    // ─────────────────────────────────────────────────────────────
    // Glyph Atlas (long-lived)
    // ─────────────────────────────────────────────────────────────

    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*()'.split('');
    const atlas = await createGlyphAtlas(
        gpu.device,
        glyphs,
        { font: '32px monospace', padding: 8 }
    );

    // Tracking long-lived resources
    persistentRM.track(atlas.texture);
    persistentRM.track(atlas.sampler);
    persistentRM.track(atlas.glyphUVsBuffer);

    // ─────────────────────────────────────────────────────────────
    // Initial Layout & Renderer
    // ─────────────────────────────────────────────────────────────

    const dims = gpu.configureCanvas();
    let layout = computeGridLayout(
        dims.width,
        dims.height,
        dims.dpr,
        atlas.cellWidth,
        atlas.cellHeight
    );

    const bundle = await createRenderBundle(
        gpu.device,
        layout,
        atlas,
        glyphs.length,
        canvas!,
        gpu.format,
    );
    let app: AppState = {
        gpu,
        layout: layout,
        renderer: bundle.renderer,
        instances: bundle.instances,
        renderGraph: bundle.graph,
    };

    // ─────────────────────────────────────────────────────────────
    // Render Loop
    // ─────────────────────────────────────────────────────────────

    const frameCallback = (
        encoder: GPUCommandEncoder,
        view: GPUTextureView,
        dt: number
    ): void => {
        app.renderGraph.execute(encoder, view, dt);
    };

    startRenderLoop(gpu.device, gpu.context, frameCallback);

    // ─────────────────────────────────────────────────────────────
    // Resize Handling (serialized)
    // ─────────────────────────────────────────────────────────────

    let resizeInProgress = false;

    async function handleResize(): Promise<void> {
        if (resizeInProgress) return;
        resizeInProgress = true;

        const dims = gpu.configureCanvas();
        const newLayout = computeGridLayout(
            dims.width,
            dims.height,
            dims.dpr,
            atlas.cellWidth,
            atlas.cellHeight
        );

        if (
            newLayout.cols === app.layout.cols &&
            newLayout.rows === app.layout.rows
        ) {
            resizeInProgress = false;
            return;
        }

        const old = app;

        const bundle = await createRenderBundle(
            gpu.device,
            newLayout,
            atlas,
            glyphs.length,
            canvas!,
            gpu.format,
        );

        app = {
            gpu,
            layout: newLayout,
            renderer: bundle.renderer,
            instances: bundle.instances,
            renderGraph: bundle.graph,
        };

        await gpu.device.queue.onSubmittedWorkDone();

        old.instances.destroy();
        old.renderer.destroy();

        resizeInProgress = false;
    }

    window.addEventListener('resize', () => {
        void handleResize();
    });
}

bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal initialization error:', err);
});
