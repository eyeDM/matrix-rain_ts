// Bootstrap entry — initialize WebGPU

import { CanvasSize } from '@runtime/canvas-resizer';
import { SwapChainController } from '@runtime/swap-chain';
import { startRenderLoop } from '@runtime/render-loop';

import { AtlasResult, createGlyphAtlas } from '@engine/render/resources';
import { ScreenUniformController } from '@engine/render/screen-uniform-controller';
import {
    SimulationDeviceResources, createSimulationDeviceResources,
    SimulationSurfaceResources, createSimulationSurfaceResources,
    SimulationComputePass,
} from '@engine/simulation/simulation-pass';
import {
    DrawDeviceResources, createDrawDeviceResources,
    DrawSurfaceResources, createDrawSurfaceResources,
    DrawPass,
} from '@engine/render/draw-pass';
import {
    PresentDeviceResources, createPresentDeviceResources,
    PresentSurfaceResources, createPresentSurfaceResources,
    PresentPass,
} from '@engine/render/present-pass';
import { RenderContext, RenderGraphBuilder, RenderGraph } from '@engine/render/render-graph';

import { WebGPUContext, initWebGPU } from '@platform/webgpu/init';
import { ShaderLoader } from '@platform/webgpu/shader-loader';
import { GpuResources } from '@platform/webgpu/resource-manager';

const COLOR_FORMAT: GPUTextureFormat = 'rgba16float'; // 'bgra8unorm'
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

/**
 * Immutable screen layout derived from canvas and atlas sizes.
 */
interface ScreenLayout {
    readonly viewport: {
        width: number;
        height: number;
        dpr: number;
    };

    readonly grid: {
        cols: number;
        rows: number;
    };

    readonly instances: {
        count: number;
        maxTrail: number;
    };
}

/**
 * Compute screen layout from physical canvas and atlas sizes.
 */
function computeScreenLayout(
    canvasSize: CanvasSize,
    cellWidth: number,
    cellHeight: number,
): ScreenLayout {
    const widthCSS = canvasSize.width * canvasSize.dpr;
    const heightCSS = canvasSize.height * canvasSize.dpr;

    const cols = Math.floor(widthCSS / cellWidth);
    const rows = Math.ceil(heightCSS / cellHeight);

    const MIN_TRAIL = 4;
    const maxTrail = Math.max(MIN_TRAIL, rows);

    return {
        viewport: {
            width: canvasSize.width,
            height: canvasSize.height,
            dpr: canvasSize.dpr,
        },
        grid: { cols, rows },
        instances: {
            count: cols * maxTrail,
            maxTrail: maxTrail,
        },
    };
}

export async function bootstrap(): Promise<void> {
    const canvasEl = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvasEl) {
        throw new Error('Canvas element `#canvas` not found');
    }

    const canvas: HTMLCanvasElement = canvasEl;

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
    const atlas: AtlasResult = await createGlyphAtlas(
        gpu.device,
        glyphs,
        { font: '32px monospace', padding: 8 },
    );

    // --- Initial layout ---

    const size: CanvasSize = swapChain.resize();

    let layout: ScreenLayout = computeScreenLayout(
        size,
        atlas.cellWidth,
        atlas.cellHeight,
    );

    // --- Screen uniforms ---

    const screen = new ScreenUniformController(gpu.device);

    screen.update(
        gpu.device,
        layout.viewport.width,
        layout.viewport.height,
    );

    // --- Resources management ---

    const resources = new GpuResources();

    // * Device-Lifetime resources

    const simDeviceResources: SimulationDeviceResources = createSimulationDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-compute'),
    );

    const drawDeviceResources: DrawDeviceResources = createDrawDeviceResources(
        gpu.device,
        resources.deviceScope,
    );

    const presentDeviceResources: PresentDeviceResources = createPresentDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-present'),
        gpu.format,
    );

    // * Surface-Lifetime resources

    function buildSurface(
        layout: ScreenLayout,
    ): {
        simPass: SimulationComputePass;
        drawPass: DrawPass;
        presentPass: PresentPass;
        renderGraph: RenderGraph;
    } {
        const simSurfaceResources: SimulationSurfaceResources = createSimulationSurfaceResources(
            gpu.device,
            resources.surfaceScope,
            simDeviceResources.pipeline,
            atlas.glyphUVsBuffer,
            atlas.glyphCount,
            atlas.cellWidth,
            atlas.cellHeight,
            layout.grid.cols,
            layout.grid.rows,
            layout.instances.maxTrail,
            layout.instances.count,
        );

        const drawSurfaceResources: DrawSurfaceResources = createDrawSurfaceResources(
            gpu.device,
            resources.surfaceScope,
            shaderLoader.get('matrix-draw'),
            atlas.sampler,
            atlas.textureView,
            simSurfaceResources.instanceBuffer,
            screen.buffer,
            COLOR_FORMAT,
            DEPTH_FORMAT,
            layout.viewport.width,
            layout.viewport.height,
        );

        const presentSurfaceResources: PresentSurfaceResources = createPresentSurfaceResources(
            gpu.device,
            resources.surfaceScope,
            presentDeviceResources.pipeline,
            presentDeviceResources.sampler,
            drawSurfaceResources.colorView,
        );

        // --- Render Passes ---

        const simPass = new SimulationComputePass(
            simDeviceResources.pipeline,
            simSurfaceResources.streamBuffers,
            simSurfaceResources.bindGroup,
            layout.grid.cols,
        );

        const drawPass = new DrawPass(
            drawDeviceResources.vertexBuffer,
            drawSurfaceResources.pipeline,
            drawSurfaceResources.bindGroup,
            drawSurfaceResources.colorView,
            drawSurfaceResources.depthView,
            layout.instances.count,
        );

        const presentPass = new PresentPass(
            presentDeviceResources.pipeline,
            presentSurfaceResources.bindGroup,
        );

        // --- Render Graph ---

        const graphBuilder = new RenderGraphBuilder();

        graphBuilder
            .addPass(simPass)
            .writes(simSurfaceResources.instanceBuffer);

        graphBuilder
            .addPass(drawPass)
            .reads(simSurfaceResources.instanceBuffer)
            .writes(drawSurfaceResources.colorView);

        graphBuilder
            .addPass(presentPass)
            .reads(drawSurfaceResources.colorView);

        const renderGraph: RenderGraph = graphBuilder.build();

        return {
            simPass,
            drawPass,
            presentPass,
            renderGraph,
        };
    }

    let surface = buildSurface(layout);
    let renderGraph = surface.renderGraph;

    // --- Render loop ---

    function makeRenderContext(
        encoder: GPUCommandEncoder,
        dt: number,
    ): RenderContext {
        return {
            device: gpu.device,
            encoder,
            dt,
            acquireView: () => swapChain.getCurrentView(),
        };
    }

    function animation(ctx: RenderContext): void {
        renderGraph.execute(ctx);
    }

    startRenderLoop(
        gpu.device,
        makeRenderContext,
        animation,
    );

    // --- Resize handling ---

    window.addEventListener('resize', () => {
        const newSize: CanvasSize = swapChain.resize();

        if (
            newSize.width === layout.viewport.width
            && newSize.height === layout.viewport.height
            && newSize.dpr === layout.viewport.dpr
        ) {
            return;
        }

        layout = computeScreenLayout(
            newSize,
            atlas.cellWidth,
            atlas.cellHeight,
        );

        screen.update(
            gpu.device,
            layout.viewport.width,
            layout.viewport.height,
        );

        // 1. Destroy ALL surface-lifetime GPU resources
        resources.surfaceScope.destroyAll();

        // 2. Rebuild surface layer
        surface = buildSurface(layout);
        renderGraph = surface.renderGraph;
    });
}

bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal initialization error:', err);
});
