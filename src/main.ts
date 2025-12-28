// Bootstrap entry — initialize WebGPU
import { WebGPUContext, initWebGPU } from './boot/webgpu-init';
import { ShaderLoader, createShaderLoader} from './boot/shader-loader';
import { CanvasSize } from './boot/canvas-resizer';
import { SwapChainController } from './gpu/swap-chain';
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
    gpu: WebGPUContext;
    renderer: Renderer;
    instances: GPUBuffer;
    renderGraph: RenderGraph;
    layout: GridLayout;
};

/**
 * Compute grid layout from physical canvas size.
 * This function is PURE and side effect free.
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
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    shaderLoader: ShaderLoader,
    atlas: Awaited<ReturnType<typeof createGlyphAtlas>>,
    glyphCount: number,
    layout: GridLayout,
): Promise<{ renderer: Renderer; instances: GPUBuffer; graph: RenderGraph }> {
    const instances = createInstanceBuffer(device, layout.instanceCount);

    const renderer = createRenderer(
        device,
        canvas,
        format,
        {
            compute: shaderLoader.get('matrix-compute'),
            draw: shaderLoader.get('matrix-draw'),
        },
        atlas.texture,
        atlas.sampler,
        atlas.glyphUVsBuffer,
        atlas.cellWidth,
        atlas.cellHeight,
        glyphCount,
        layout.cols,
        layout.rows,
        layout.maxTrail,
        layout.instanceCount,
        instances,
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
    const swapChain = new SwapChainController(
        canvas,
        gpu.context,
        gpu.device,
        gpu.format,
    );

    // Resource manager for long-lived resources (glyph atlas, samplers)
    const persistentRM = createResourceManager(gpu.device);

    // ─────────────────────────────────────────────────────────────
    // Shader Library (long-lived, global)
    // ─────────────────────────────────────────────────────────────
    const shaderLoader = createShaderLoader(gpu.device);

    await Promise.all([
        // Load compute WGSL
        shaderLoader.load(
            'matrix-compute',
            new URL('./sim/gpu-update.wgsl', import.meta.url).href
        ),
        // Load draw shader
        shaderLoader.load(
            'matrix-draw',
            new URL('./shaders/draw-symbols.wgsl', import.meta.url).href
        ),
    ]);

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

    //const dims = gpu.configureCanvas();
    const size: CanvasSize = swapChain.resize();
    let layout: GridLayout = computeGridLayout(
        size.width,
        size.height,
        size.dpr,
        atlas.cellWidth,
        atlas.cellHeight
    );

    const bundle = await createRenderBundle(
        gpu.device,
        canvas!,
        gpu.format,
        shaderLoader,
        atlas,
        glyphs.length,
        layout,
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

    startRenderLoop(
        gpu.device,
        (encoder, dt) => ({
            encoder,
            dt,
            acquireView: () => swapChain.getCurrentView(),
        }),
        (frame) => {
            const view = frame.acquireView();
            if (!view) return;

            app.renderGraph.execute(frame.encoder, view, frame.dt);
        },
    );

    // ─────────────────────────────────────────────────────────────
    // Resize Handling (serialized)
    // ─────────────────────────────────────────────────────────────

    let resizeInProgress = false;

    async function handleResize(): Promise<void> {
        if (resizeInProgress) return;
        resizeInProgress = true;

        const size: CanvasSize = swapChain.resize();
        const newLayout: GridLayout = computeGridLayout(
            size.width,
            size.height,
            size.dpr,
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
            canvas!,
            gpu.format,
            shaderLoader,
            atlas,
            glyphs.length,
            newLayout,
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
