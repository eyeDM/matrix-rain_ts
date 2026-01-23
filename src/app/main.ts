// Bootstrap entry — initialize WebGPU

import { WebGPUContext, initWebGPU } from '@backend/init';
import { ShaderLoader } from '@backend/shader-loader';
import { GpuResources } from '@backend/resource-tracker';

import { ScreenUniformBuffer } from '@gpu/screen-uniform-buffer';
import { HistoryParamsLayout } from '@backend/layouts';
import {
    SimulationDeviceResources, createSimulationDeviceResources,
    SimulationSurfaceResources, createSimulationSurfaceResources,
    SimulationComputePass,
} from '@gpu/simulation-pass';
import {
    DrawDeviceResources, createDrawDeviceResources,
    DrawSurfaceResources, createDrawSurfaceResources,
    DrawPass,
} from '@gpu/draw-pass';
import {
    PresentDeviceResources, createPresentDeviceResources,
    PresentSurfaceResources, createPresentSurfaceResources,
    PresentPass,
} from '@gpu/present-pass';
import { PresentUniformBuffer } from '@gpu/present-uniform-buffer';
import {
    HistoryDeviceResources, createHistoryDeviceResources,
    HistoryComputePass,
} from '@gpu/history-pass';
import { RenderContext, RenderGraphBuilder, RenderGraph } from '@gpu/render-graph';

import { AtlasResult, createGlyphAtlas } from '@domain/glyph-atlas';

import { CanvasSize } from '@runtime/canvas-resizer';
import { SwapChainController } from '@runtime/swap-chain';
import { startRenderLoop } from '@runtime/render-loop';

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
    const cols = Math.floor(canvasSize.width / cellWidth);
    const rows = Math.ceil(canvasSize.height / cellHeight);

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
        shaderLoader.load(
            'matrix-compute',
            new URL('./../assets/shaders/compute.wgsl', import.meta.url).href
        ),
        shaderLoader.load(
            'matrix-draw',
            new URL('./../assets/shaders/draw.wgsl', import.meta.url).href
        ),
        shaderLoader.load(
            'matrix-present',
            new URL('./../assets/shaders/present.wgsl', import.meta.url).href
        ),
        shaderLoader.load(
            'matrix-history',
            new URL('./../assets/shaders/history.wgsl', import.meta.url).href
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

    // --- Resources management ---

    const resources = new GpuResources();

    // * Device-Lifetime resources

    const screen = new ScreenUniformBuffer(gpu.device, resources.deviceScope);
    screen.update(layout.viewport.width, layout.viewport.height);

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
    const historyDeviceResources: HistoryDeviceResources = createHistoryDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-history'),
    );

    // Present uniform buffer (device-lifetime)
    const presentUniform = new PresentUniformBuffer(
        gpu.device,
        resources.deviceScope,
    );
    presentUniform.update({
        width: size.width,
        height: size.height,
        time: 0,
        vignetteStrength: 0.15,
        scanlineStrength: 0.06,
        noiseAmplitude: 0.02,
        curvature: 0.03,
        tint: [0.0, 1.0, 0.0],
        scanlineFreq: 200.0,
    });

    // * Surface-Lifetime resources

    function buildSurface(layout: ScreenLayout): {
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

        // --- Create present surface resources (legacy single-frame bind group kept for compatibility) ---
        const presentSurfaceResources: PresentSurfaceResources = createPresentSurfaceResources(
            gpu.device,
            resources.surfaceScope,
            presentDeviceResources.pipeline,
            presentDeviceResources.sampler,
            drawSurfaceResources.colorView,
            presentUniform.buffer,
        );

        // --- History textures & history compute pass ---
        const historyTexA = resources.surfaceScope.trackDestroyable(
            gpu.device.createTexture({
                size: [layout.viewport.width, layout.viewport.height],
                format: COLOR_FORMAT,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
            })
        );
        const historyTexB = resources.surfaceScope.trackDestroyable(
            gpu.device.createTexture({
                size: [layout.viewport.width, layout.viewport.height],
                format: COLOR_FORMAT,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
            })
        );

        const paramsBuffer = resources.surfaceScope.trackDestroyable(
            gpu.device.createBuffer({
                label: 'History Params',
                size: HistoryParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        // default decay
        const decay = 0.85;
        const decayStaging = new ArrayBuffer(HistoryParamsLayout.SIZE);
        const dv = new DataView(decayStaging);
        dv.setFloat32(HistoryParamsLayout.offsets.decay, decay, true);
        gpu.device.queue.writeBuffer(paramsBuffer, 0, decayStaging);

        const historyPass = new HistoryComputePass(
            gpu.device,
            historyDeviceResources.pipeline,
            historyDeviceResources.sampler,
            resources.frameScope,
            drawSurfaceResources.colorView,
            historyTexA,
            historyTexB,
            paramsBuffer,
            layout.viewport.width,
            layout.viewport.height,
        );

        // final present pass will sample the latest history output via a getter
        const presentPass = new PresentPass(
            presentDeviceResources.pipeline,
            presentDeviceResources.sampler,
            () => historyPass.getOutputView(),
            presentUniform.buffer,
            resources.frameScope,
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
            .addPass(historyPass)
            .reads(drawSurfaceResources.colorView)
            .writes(historyTexA, historyTexB);

        graphBuilder
            .addPass(presentPass)
            .reads(historyTexA, historyTexB);

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
    let timeAccumulator = 0;

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
        // update present-time uniform
        timeAccumulator += ctx.dt;
        presentUniform.update({
            width: layout.viewport.width,
            height: layout.viewport.height,
            time: timeAccumulator,
            vignetteStrength: 0.15,
            scanlineStrength: 0.06,
            noiseAmplitude: 0.02,
            curvature: 0.03,
            tint: [0.0, 1.0, 0.0],
            scanlineFreq: 200.0,
        });

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

        screen.update(layout.viewport.width, layout.viewport.height);

        // update present uniform size
        presentUniform.update({
            width: layout.viewport.width,
            height: layout.viewport.height,
            time: timeAccumulator,
            vignetteStrength: 0.15,
            scanlineStrength: 0.06,
            noiseAmplitude: 0.02,
            curvature: 0.03,
            tint: [0.0, 1.0, 0.0],
            scanlineFreq: 200.0,
        });

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
