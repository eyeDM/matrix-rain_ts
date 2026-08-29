// Bootstrap entry — initialize WebGPU

import { ColumnStateLayout } from '@backend/layouts';
import { WebGPUContext, initWebGPU, showWebGPUNotSupported } from '@backend/init';
import { ShaderLoader } from '@backend/shader-loader';
import { GpuResources } from '@backend/resource-tracker';

import { TRAIL_LENGTH_MIN, TRAIL_LENGTH_MAX, ColumnsState } from '@gpu/column-state';
import { ViewportParamsWriter } from '@gpu/viewport-params-writer';
import { FrameParamsWriter } from '@gpu/frame-params-writer';
import { SimulationParamsWriter } from '@gpu/simulation-params-writer';
import { GlyphGridParamsWriter } from '@gpu/glyph-grid-params-writer';
import { HistoryParamsWriter } from '@gpu/history-params-writer';
import { PresentParamsWriter } from '@gpu/present-params-writer';

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

import { ConfigParameters, initEffectsPanel } from '@app/effects-panel';

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
        cols: number; // compute dispatch size
        rows: number;
    };

    readonly instances: {
        count: number; // for render
        minTrail: number; // logical shader limits
        maxTrail: number;
    };
}

interface SurfaceBundle {
    readonly simPass: SimulationComputePass;
    readonly drawPass: DrawPass;
    readonly blurPassH: BlurPass;
    readonly blurPassV: BlurPass;
    readonly historyPass: HistoryComputePass;
    readonly presentPass: PresentPass;
    readonly renderGraph: RenderGraph;
}

/**
 * Compute screen layout from physical canvas and atlas sizes.
 */
function computeScreenLayout(
    canvasSize: CanvasSize,
    cellWidth: number,
    cellHeight: number,
    limits: GPUSupportedLimits,
): ScreenLayout {
    if (cellWidth <= 0 || cellHeight <= 0) {
        throw new Error('Cell size must be > 0');
    }

    const cols = Math.max(1, Math.floor(canvasSize.width / cellWidth));
    const rows = Math.max(1, Math.ceil(canvasSize.height / cellHeight));

    const maxTrail = Math.min(rows, TRAIL_LENGTH_MAX);
    const minTrail = Math.min(TRAIL_LENGTH_MIN, maxTrail);

    const requiredColumnStateBytes = cols * ColumnStateLayout.SIZE;
    if (requiredColumnStateBytes > limits.maxStorageBufferBindingSize) {
        throw new Error(
            `ColumnState buffer exceeds maxStorageBufferBindingSize: ${requiredColumnStateBytes}`,
        );
    }

    return {
        viewport: {
            width: canvasSize.width,
            height: canvasSize.height,
            dpr: canvasSize.dpr,
        },

        grid: { cols, rows },

        instances: {
            count: cols * maxTrail,
            minTrail,
            maxTrail,
        }
    };
}

const cfg: ConfigParameters = {
    scale: 1.0,
    // DrawParams
    flickerAmplitude: 0.08,
    flickerFrequency: 1.6,
    // HistoryParams
    retention: 0.4,
    // PresentParams
    vignetteStrength: 0.1,
    scanlineFreq: 200.0,
    scanlineStrength: 0.6,
    noiseAmplitude: 0.01,
    curvature: 0.04,
    tint: [0.00, 1.00, 0.20],
    bloomIntensity: 0.4,
};

export async function bootstrap(): Promise<void> {
    const canvasEl = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvasEl) {
        throw new Error('Canvas element `#canvas` not found');
    }

    const canvas: HTMLCanvasElement = canvasEl;

    // --- WebGPU ---

    let gpu: WebGPUContext;
    try {
        gpu = await initWebGPU(canvas);
    } catch (err) {
        // Covers adapter/device acquisition failures
        console.error('WebGPU initialization failed:', err);
        showWebGPUNotSupported();
        return;
    }

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
            'matrix-simulation',
            new URL('./../assets/shaders/simulation.wgsl', import.meta.url).href
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

    // --- Resources management ---

    const resources = new GpuResources();

    // --- Glyph atlas (long-lived) ---

    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+/?;'.split('');
    const atlas: AtlasResult = await createGlyphAtlas(
        gpu.device,
        resources.deviceScope,
        glyphs,
        { font: '32px monospace', padding: 8 },
    );

    // --- Initial layout ---

    const size: CanvasSize = swapChain.resize(cfg.scale);

    let layout: ScreenLayout = computeScreenLayout(
        size,
        atlas.layout.cellWidth,
        atlas.layout.cellHeight,
        gpu.device.limits,
    );

    // * Device-Lifetime resources

    const viewportParamsWriter = new ViewportParamsWriter(
        gpu.device,
        resources.deviceScope,
    );
    const updateViewportParams = (): void => {
        viewportParamsWriter.update({
            width: layout.viewport.width,
            height: layout.viewport.height,
        });
    };

    const frameParamsWriter = new FrameParamsWriter(
        gpu.device,
        resources.deviceScope,
    );

    const simulationParamsWriter = new SimulationParamsWriter(
        gpu.device,
        resources.deviceScope,
    );
    const updateSimulationParams = (): void => {
        simulationParamsWriter.update({
            flickerAmplitude: cfg.flickerAmplitude,
            flickerFrequency: cfg.flickerFrequency,
        });
    };

    const glyphGridParamsWriter = new GlyphGridParamsWriter(
        gpu.device,
        resources.deviceScope,
    );
    const updateGlyphGridParams = (): void => {
        glyphGridParamsWriter.update({
            cellWidth: atlas.layout.cellWidth,
            cellHeight: atlas.layout.cellHeight,
            atlasWidth: atlas.layout.atlasWidth,
            atlasHeight: atlas.layout.atlasHeight,
            glyphCount: atlas.glyphs.count,

            cols: layout.grid.cols,
            rows: layout.grid.rows,
            minTrail: layout.instances.minTrail,
            maxTrail: layout.instances.maxTrail,
        });
    };

    const historyParamsWriter = new HistoryParamsWriter(
        gpu.device,
        resources.deviceScope,
    );
    const updateHistoryParams = (): void => {
        historyParamsWriter.update({retention: cfg.retention});
    };

    const presentParamsWriter = new PresentParamsWriter(
        gpu.device,
        resources.deviceScope,
    );
    const updatePresentParams = (): void => {
        presentParamsWriter.update({
            vignetteStrength: cfg.vignetteStrength,
            scanlineFreq: cfg.scanlineFreq,
            scanlineStrength: cfg.scanlineStrength,
            noiseAmplitude: cfg.noiseAmplitude,
            curvature: cfg.curvature,
            tint: cfg.tint,
            bloomIntensity: cfg.bloomIntensity,
        });
    };

    const simDeviceResources: SimulationDeviceResources = createSimulationDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-simulation'),
    );

    const drawDeviceResources: DrawDeviceResources = createDrawDeviceResources(
        gpu.device,
        resources.deviceScope,
        atlas.glyphs.minBindingSize,
    );

    const historyDeviceResources: HistoryDeviceResources = createHistoryDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-history'),
    );

    const blurDeviceResources: BlurDeviceResources = createBlurDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-blur'),
    );

    const presentDeviceResources: PresentDeviceResources = createPresentDeviceResources(
        gpu.device,
        resources.deviceScope,
        shaderLoader.get('matrix-present'),
        gpu.format,
    );

    // * Surface-Lifetime bundle

    function buildSurface(layout: ScreenLayout): SurfaceBundle {
        // --- Resources ---
        const columnsState = new ColumnsState(
            gpu.device,
            resources.surfaceScope,
            layout.grid.cols,
            layout.grid.rows,
            layout.instances.minTrail,
            layout.instances.maxTrail,
        );

        const simSurfaceResources: SimulationSurfaceResources = createSimulationSurfaceResources(
            gpu.device,
            resources.surfaceScope,
            simDeviceResources.pipeline,
            {
                glyphGridParamsBuffer: glyphGridParamsWriter.buffer,
                frameParamsBuffer: frameParamsWriter.buffer,
                simulationParamsBuffer: simulationParamsWriter.buffer,
                columnStateBuffer: columnsState.buffer,
            },
        );

        const drawSurfaceResources: DrawSurfaceResources = createDrawSurfaceResources(
            gpu.device,
            resources.surfaceScope,
            shaderLoader.get('matrix-draw'),
            drawDeviceResources.bindGroupLayout,
            {
                atlasTextureView: atlas.resources.textureView,
                atlasSampler: atlas.resources.sampler,
                glyphUVsBuffer: atlas.resources.uvBuffer,
                columnStateBuffer: columnsState.buffer,
                viewportParamsBuffer: viewportParamsWriter.buffer,
                glyphGridParamsBuffer: glyphGridParamsWriter.buffer,
            },
            atlas.glyphs.minBindingSize,
            layout.viewport.width,
            layout.viewport.height,
        );

        const blurSurfaceResources: BlurSurfaceResources = createBlurSurfaceResources(
            gpu.device,
            resources.surfaceScope,
            blurDeviceResources.pipeline,
            blurDeviceResources.sampler,
            drawSurfaceResources.brightTex,
            layout.viewport.width,
            layout.viewport.height,
        );

        const historySurfaceResources: HistorySurfaceResources = createHistorySurfaceResources(
            gpu.device,
            resources.surfaceScope,
            layout.viewport.width,
            layout.viewport.height,
        );

        // --- Render Passes ---

        const simPass = new SimulationComputePass(
            simDeviceResources.pipeline,
            simSurfaceResources.bindGroup,
            layout.grid.cols,
        );

        const drawPass = new DrawPass(
            drawDeviceResources.vertexBuffer,
            drawSurfaceResources.pipeline,
            drawSurfaceResources.bindGroup,
            drawSurfaceResources.colorTex,
            drawSurfaceResources.brightTex,
            layout.instances.count,
        );

        const historyPass = new HistoryComputePass(
            gpu.device,
            resources.surfaceScope,
            historyDeviceResources.pipeline,
            drawSurfaceResources.colorTex,
            historySurfaceResources.historyTexA,
            historySurfaceResources.historyTexB,
            viewportParamsWriter.buffer,
            frameParamsWriter.buffer,
            historyParamsWriter.buffer,
            layout.viewport.width,
            layout.viewport.height,
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

        // final present pass will sample the latest history output via a getter
        const presentPass = new PresentPass(
            resources.frameScope,
            presentDeviceResources.pipeline,
            presentDeviceResources.sampler,
            frameParamsWriter.buffer,
            presentParamsWriter.buffer,
            () => historyPass.getOutputView(),
            () => swapChain.getCurrentView(),
            blurSurfaceResources.texResult,
        );

        // --- Render Graph ---

        const graphBuilder = new RenderGraphBuilder();

        graphBuilder.addPass(simPass)
            .writes(columnsState.buffer);

        graphBuilder.addPass(drawPass)
            .reads(columnsState.buffer)
            .writes(
                drawSurfaceResources.colorTex,
                drawSurfaceResources.brightTex,
            );

        graphBuilder.addPass(historyPass)
            .reads(drawSurfaceResources.colorTex)
            .writes(
                historySurfaceResources.historyTexA,
                historySurfaceResources.historyTexB,
            );

        graphBuilder.addPass(blurPassH)
            .reads(drawSurfaceResources.brightTex)
            .writes(blurSurfaceResources.texTemp);

        graphBuilder.addPass(blurPassV)
            .reads(blurSurfaceResources.texTemp)
            .writes(blurSurfaceResources.texResult);

        graphBuilder.addPass(presentPass)
            .reads(
                historySurfaceResources.historyTexA,
                historySurfaceResources.historyTexB,
                blurSurfaceResources.texResult,
            );

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

    // --- Initial data ---

    updateViewportParams();
    updateSimulationParams();
    updateGlyphGridParams();
    updateHistoryParams();
    updatePresentParams();

    // --- Render loop ---

    // Centralized time management with periodic wrapping for numerical stability
    const timeManager = new TimeManager();

    function onEachFrame(ctx: RenderContext): void {
        // Update time state
        timeManager.tick(ctx.dt);
        const periodicTime = timeManager.getPeriodic();

        frameParamsWriter.update({
            dt: ctx.dt,
            time: periodicTime,
        });

        surface.renderGraph.execute(ctx);
        resources.frameScope.destroyAll();
    }

    startRenderLoop(gpu.device, onEachFrame);

    // --- Resize handling ---

    function onResize(): void {
        const newSize: CanvasSize = swapChain.resize(cfg.scale);

        if (
            newSize.width === layout.viewport.width
            && newSize.height === layout.viewport.height
            && newSize.dpr === layout.viewport.dpr
        ) {
            return;
        }

        layout = computeScreenLayout(
            newSize,
            atlas.layout.cellWidth,
            atlas.layout.cellHeight,
            gpu.device.limits,
        );

        // 1. Update ScreenLayout-dependent pass parameters
        updateViewportParams();
        updateGlyphGridParams();

        // 2. Destroy ALL Surface-Lifetime GPU resources
        resources.surfaceScope.destroyAll();

        // 3. Rebuild surface layer
        surface = buildSurface(layout);
    }

    window.addEventListener('resize', onResize);

    // --- Debug UI (runtime parameter tuning) ---

    initEffectsPanel(
        cfg,
        (changedConfig: Partial<ConfigParameters>) => {
            const oldCfg = { ...cfg };
            Object.assign(cfg, changedConfig);

            if (cfg.scale !== oldCfg.scale) {
                onResize();
            }

            updatePresentParams();

            if (
                cfg.flickerAmplitude !== oldCfg.flickerAmplitude
                || cfg.flickerFrequency !== oldCfg.flickerFrequency
            ) {
                updateSimulationParams();
            }

            if (cfg.retention !== oldCfg.retention) {
                updateHistoryParams();
            }
        },
    );
}

bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal initialization error:', err);
});
