// Bootstrap entry — initialize WebGPU

import { WebGPUContext, initWebGPU } from '@backend/init';
import { ShaderLoader } from '@backend/shader-loader';
import { GpuResources } from '@backend/resource-tracker';

import { ScreenUniformBuffer } from '@gpu/screen-uniform-buffer';

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
    PresentPass,
} from '@gpu/present-pass';
import {
    BlurDeviceResources, createBlurDeviceResources,
    BlurSurfaceResources, createBlurSurfaceResources,
    BlurPass,
} from '@gpu/blur-pass';
import { PresentUniformBuffer } from '@gpu/present-uniform-buffer';
import {
    HistoryDeviceResources, createHistoryDeviceResources,
    HistorySurfaceResources, createHistorySurfaceResources,
    HistoryComputePass,
} from '@gpu/history-pass';
import { RenderContext, RenderGraphBuilder, RenderGraph } from '@gpu/render-graph';

import { AtlasResult, createGlyphAtlas } from '@domain/glyph-atlas';

import { CanvasSize } from '@runtime/canvas-resizer';
import { SwapChain } from '@runtime/swap-chain';
import { startRenderLoop } from '@runtime/render-loop';
import { TimeManager } from '@runtime/time-manager';

import { createDebugUI, PresentParams } from '@app/debug-ui';

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

    const swapChain = new SwapChain(
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
            'matrix-history',
            new URL('./../assets/shaders/history.wgsl', import.meta.url).href
        ),
        shaderLoader.load(
            'matrix-blur',
            new URL('./../assets/shaders/blur.wgsl', import.meta.url).href
        ),
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

    const historyDeviceResources: HistoryDeviceResources = createHistoryDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-history'),
        COLOR_FORMAT,
    );

    const blurDeviceResources: BlurDeviceResources = createBlurDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-blur'),
        COLOR_FORMAT,
    );

    const presentDeviceResources: PresentDeviceResources = createPresentDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-present'),
        gpu.format,
    );

    const presentUniform = new PresentUniformBuffer(
        gpu.device,
        resources.deviceScope,
    );
    presentUniform.update({
        width: layout.viewport.width,
        height: layout.viewport.height,
        time: 0,
        vignetteStrength: 0.15,
        scanlineStrength: 0.06,
        noiseAmplitude: 0.02,
        curvature: 0.03,
        tint: [0.0, 1.0, 0.0],
        scanlineFreq: 200.0,
        bloomIntensity: 0.35,
    });

    // * Surface-Lifetime bundle

    function buildSurface(layout: ScreenLayout): {
        simPass: SimulationComputePass;
        drawPass: DrawPass;
        blurPassH: BlurPass;
        blurPassV: BlurPass;
        historyPass: HistoryComputePass;
        presentPass: PresentPass;
        renderGraph: RenderGraph;
    } {
        // --- Resources ---

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

        const blurSurfaceResources: BlurSurfaceResources = createBlurSurfaceResources(
            gpu.device,
            resources.surfaceScope,
            blurDeviceResources.pipeline,
            blurDeviceResources.sampler,
            drawSurfaceResources.colorTex,
            COLOR_FORMAT,
            layout.viewport.width,
            layout.viewport.height,
        );

        const historySurfaceResources: HistorySurfaceResources = createHistorySurfaceResources(
            gpu.device,
            resources.surfaceScope,
            COLOR_FORMAT,
            layout.viewport.width,
            layout.viewport.height,
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
            drawSurfaceResources.colorTex,
            drawSurfaceResources.depthTex,
            layout.instances.count,
        );

        const blurPassH = new BlurPass(
            blurDeviceResources.pipeline,
            blurSurfaceResources.bindGroupH,
            blurSurfaceResources.texTemp,
        );

        const blurPassV = new BlurPass(
            blurDeviceResources.pipeline,
            blurSurfaceResources.bindGroupV,
            blurSurfaceResources.texResult,
        );

        const historyPass = new HistoryComputePass(
            resources.frameScope,
            historyDeviceResources.pipeline,
            historyDeviceResources.sampler,
            drawSurfaceResources.colorTex,
            historySurfaceResources.historyTexA,
            historySurfaceResources.historyTexB,
            historySurfaceResources.paramsBuffer,
            layout.viewport.width,
            layout.viewport.height,
        );
        // default decay
        historyPass.updateDecay(gpu.device, 0.75);

        // final present pass will sample the latest history output via a getter
        const presentPass = new PresentPass(
            resources.frameScope,
            presentDeviceResources.pipeline,
            presentDeviceResources.sampler,
            presentUniform.buffer,
            () => historyPass.getOutputView(),
            () => swapChain.getCurrentView(),
            blurSurfaceResources.texResult,
        );

        // --- Render Graph ---

        const graphBuilder = new RenderGraphBuilder();

        graphBuilder
            .addPass(simPass)
            .writes(simSurfaceResources.instanceBuffer);

        graphBuilder
            .addPass(drawPass)
            .reads(simSurfaceResources.instanceBuffer)
            .writes(drawSurfaceResources.colorTex);

        graphBuilder
            .addPass(blurPassH)
            .reads(drawSurfaceResources.colorTex)
            .writes(blurSurfaceResources.texTemp);

        graphBuilder
            .addPass(blurPassV)
            .reads(blurSurfaceResources.texTemp)
            .writes(blurSurfaceResources.texResult);

        graphBuilder
            .addPass(historyPass)
            .reads(drawSurfaceResources.colorTex)
            .writes(historySurfaceResources.historyTexA, historySurfaceResources.historyTexB);

        graphBuilder
            .addPass(presentPass)
            .reads(historySurfaceResources.historyTexA, historySurfaceResources.historyTexB)
            .reads(blurSurfaceResources.texResult);

        const renderGraph: RenderGraph = graphBuilder.build();

        return {
            simPass,
            drawPass,
            blurPassH,
            blurPassV,
            historyPass,
            presentPass,
            renderGraph,
        };
    }

    let surface = buildSurface(layout);
    let renderGraph = surface.renderGraph;

    // --- Render loop ---

    // Centralized time management with periodic wrapping for numerical stability
    const timeManager = new TimeManager();

    function onEachFrame(ctx: RenderContext): void {
        // Update time state (wraps to [0, 2π) to prevent f32 precision loss in shaders)
        timeManager.tick(ctx.dt);
        const periodicTime = timeManager.getPeriodic();

        // update present-time uniform
        presentUniform.update({
            width: layout.viewport.width,
            height: layout.viewport.height,
            time: periodicTime,
            vignetteStrength: presentState.vignetteStrength,
            scanlineStrength: presentState.scanlineStrength,
            noiseAmplitude: presentState.noiseAmplitude,
            curvature: presentState.curvature,
            tint: presentState.tint,
            scanlineFreq: presentState.scanlineFreq,
            bloomIntensity: presentState.bloomIntensity,
        });

        // update simulation flicker state on the sim pass so compute shader can use it
        try {
            surface.simPass.setFlickerState(
                periodicTime,
                presentState.flickerAmplitude,
                presentState.flickerFreq,
            );
        } catch {
            /* surface may be rebuilt on resize */
        }

        renderGraph.execute(ctx);
        resources.frameScope.destroyAll();
    }

    startRenderLoop(gpu.device, onEachFrame);

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

        // update present uniform size (preserve UI-driven params)
        presentUniform.update({
            width: layout.viewport.width,
            height: layout.viewport.height,
            time: timeManager.getPeriodic(),
            vignetteStrength: presentState.vignetteStrength,
            scanlineStrength: presentState.scanlineStrength,
            noiseAmplitude: presentState.noiseAmplitude,
            curvature: presentState.curvature,
            tint: presentState.tint,
            scanlineFreq: presentState.scanlineFreq,
            bloomIntensity: presentState.bloomIntensity,
        });

        // 1. Destroy ALL surface-lifetime GPU resources
        resources.surfaceScope.destroyAll();

        // 2. Rebuild surface layer
        surface = buildSurface(layout);
        renderGraph = surface.renderGraph;
    });

    // --- Debug UI (runtime parameter tuning) ---

    const presentState: PresentParams = {
        vignetteStrength: 0.15,
        scanlineStrength: 0.06,
        noiseAmplitude: 0.02,
        curvature: 0.03,
        tint: [0.0, 1.0, 0.0],
        scanlineFreq: 200.0,
        bloomIntensity: 0.35,
        flickerAmplitude: 0.06,
        flickerFreq: 0.6,
    };

    createDebugUI(
        presentState,
        (partial) => {
            Object.assign(presentState, partial);
            presentUniform.update({
                width: layout.viewport.width,
                height: layout.viewport.height,
                time: timeManager.getPeriodic(),
                vignetteStrength: presentState.vignetteStrength,
                scanlineStrength: presentState.scanlineStrength,
                noiseAmplitude: presentState.noiseAmplitude,
                curvature: presentState.curvature,
                tint: presentState.tint,
                scanlineFreq: presentState.scanlineFreq,
                bloomIntensity: presentState.bloomIntensity,
            });
        },
        (decayVal) => {
            // delegate to the active surface's updater; surface may be rebuilt on resize
            surface.historyPass.updateDecay(gpu.device, decayVal);
        },
    );
}

bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal initialization error:', err);
});
