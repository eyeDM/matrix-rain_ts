// Bootstrap entry — initialize WebGPU

import { SwapChainController } from '@runtime/swap-chain';
import { startRenderLoop } from '@runtime/render-loop';
import { CanvasSize } from '@runtime/canvas-resizer';

import { SimulationEngine, createSimulationEngine } from '@engine/simulation/simulation-engine';
import { ScreenUniformController } from '@engine/render/screen-uniform-controller';
import { createGlyphAtlas } from '@engine/render/resources';
import { Renderer, createRenderer} from '@engine/render/renderer';
import { createRenderTargetRegistry } from '@engine/render/render-target-registry';
import { createPresentPass } from '@engine/render/present-pass';
import { RenderGraph, createRenderGraph } from '@engine/render/render-graph';

import { WebGPUContext, initWebGPU } from '@platform/webgpu/init';
import { ShaderLoader } from '@platform/webgpu/shader-loader';

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
    layout: GridLayout;
    simulation: SimulationEngine;
    renderer: Renderer;
    screen: ScreenUniformController;
    renderGraph: RenderGraph;
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

function makeAppBundle(
    gpu: WebGPUContext,
    shaderLoader: ShaderLoader,
    atlas: Awaited<ReturnType<typeof createGlyphAtlas>>,
    layout: GridLayout,
): AppState {
    const simulation = createSimulationEngine({
        device: gpu.device,
        shader: shaderLoader.get('matrix-compute'),
        glyphUVsBuffer: atlas.glyphUVsBuffer,
        cols: layout.cols,
        rows: layout.rows,
        glyphCount: atlas.glyphCount,
        cellWidth: atlas.cellWidth,
        cellHeight: atlas.cellHeight,
        maxTrail: layout.maxTrail,
    });

    const screen = new ScreenUniformController(gpu.device);

    const renderer = createRenderer(
        gpu.device,
        'rgba16float',
        'depth24plus',
        shaderLoader.get('matrix-draw'),
        atlas.texture,
        atlas.sampler,
        simulation.instances,
        layout.instanceCount,
        screen.buffer
    );

    const presentPass = createPresentPass(
        gpu.device,
        gpu.format,
        shaderLoader.get('matrix-present'),
        'sceneColor'
    );

    const renderGraph = createRenderGraph();
    renderGraph.addPass(simulation.computePass);
    renderGraph.addPass(renderer.drawPass);
    renderGraph.addPass(presentPass);

    return {
        gpu,
        layout,
        simulation,
        renderer,
        screen,
        renderGraph,
    };
}

export async function bootstrap(): Promise<void> {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('Canvas element `#canvas` not found');

    // --- WebGPU ---

    const gpu: WebGPUContext = await initWebGPU(canvas);

    const swapChain = new SwapChainController(
        canvas,
        gpu.context,
        gpu.device,
        gpu.format,
    );

    // --- Shader library (long-lived, global) ---

    const shaderLoader = new ShaderLoader(gpu.device);

    await Promise.all([
        // Load compute WGSL
        shaderLoader.load(
            'matrix-compute',
            new URL('./../assets/shaders/gpu-update.wgsl', import.meta.url).href
        ),
        // Load draw shader
        shaderLoader.load(
            'matrix-draw',
            new URL('./../assets/shaders/draw-symbols.wgsl', import.meta.url).href
        ),
        // Load present shader
        shaderLoader.load(
            'matrix-present',
            new URL('./../assets/shaders/present.wgsl', import.meta.url).href
        ),
    ]);

    // --- Glyph atlas (long-lived) ---

    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+/?;'.split('');
    const atlas = await createGlyphAtlas(
        gpu.device,
        glyphs,
        { font: '32px monospace', padding: 8 }
    );

    // --- Initial layout ---

    const size: CanvasSize = swapChain.resize();
    let layout: GridLayout = computeGridLayout(
        size.width,
        size.height,
        size.dpr,
        atlas.cellWidth,
        atlas.cellHeight
    );

    let app: AppState = makeAppBundle(
        gpu,
        shaderLoader,
        atlas,
        layout,
    );

    // --- Render loop ---

    const renderTargets = createRenderTargetRegistry(
        gpu.device,
        size.width,
        size.height
    );

    startRenderLoop(
        gpu.device,
        (encoder, dt) => ({
            encoder,
            dt,
            resources: renderTargets,
            acquireView: () => swapChain.getCurrentView(),
        }),
        (ctx) => {
            // Update screen uniforms (CPU → GPU, persistent buffer)
            app.screen.update(gpu.device, canvas.width, canvas.height);

            app.renderGraph.execute(ctx);
        },
    );

    // --- Resize handling (coarse, to be optimized later) ---

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

        renderTargets.resize(size.width, size.height);

        if (
            newLayout.cols === app.layout.cols &&
            newLayout.rows === app.layout.rows
        ) {
            resizeInProgress = false;
            return;
        }

        const oldApp = app;

        app = makeAppBundle(
            gpu,
            shaderLoader,
            atlas,
            newLayout,
        );

        await gpu.device.queue.onSubmittedWorkDone();

        oldApp.screen.destroy();
        oldApp.renderer.destroy();
        oldApp.simulation.destroy();

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
