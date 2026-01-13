// Bootstrap entry — initialize WebGPU

import { SwapChainController } from '@runtime/swap-chain';
import { startRenderLoop } from '@runtime/render-loop';
import { CanvasSize } from '@runtime/canvas-resizer';

import { createGlyphAtlas, createInstanceBuffer } from '@engine/render/resources';
import { ScreenUniformController } from '@engine/render/screen-uniform-controller';
import { createSimulationNode } from '@engine/simulation/simulation-node';
import { createDrawNode } from '@engine/render/draw-node';
import { createPresentNode } from '@engine/render/present-node';
import { RenderTargetRegistry } from '@engine/render/render-target-registry';
import { RenderNode, CompiledRenderGraph, RenderGraphBuilder } from '@engine/render/render-graph';

import { InstanceLayout } from '@platform/webgpu/layouts';
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

export async function bootstrap(): Promise<void> {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
        throw new Error('Canvas element `#canvas` not found');
    }

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
        { font: '32px monospace', padding: 8 },
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

    // --- Screen uniforms ---

    const screen = new ScreenUniformController(gpu.device);

    // --- RenderGraph: build phase ---

    const graphBuilder = new RenderGraphBuilder();

    // Resources (authoritative)
    const instanceBuffer = graphBuilder.createBuffer('InstanceBuffer', {
        size: layout.instanceCount * InstanceLayout.SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
    });

    const sceneColor = graphBuilder.createTexture('sceneColor', {
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        size: 'screen',
    });

    // --- RenderNodes ---

    const instances: GPUBuffer = createInstanceBuffer(
        gpu.device,
        layout.cols * layout.maxTrail
    );

    const simulation: RenderNode = createSimulationNode(
        gpu.device,
        shaderLoader.get('matrix-compute'),
        atlas.glyphUVsBuffer,
        instances,
        layout.cols,
        layout.rows,
        atlas.glyphCount,
        atlas.cellWidth,
        atlas.cellHeight,
        layout.maxTrail,
    );

    const draw: RenderNode = createDrawNode(
        gpu.device,
        'rgba16float',
        //'depth24plus',
        shaderLoader.get('matrix-draw'),
        atlas.texture,
        atlas.sampler,
        screen.buffer,
        instances,
        layout.instanceCount,
        'sceneColor',
    );

    const present: RenderNode = createPresentNode(
        gpu.device,
        gpu.format,
        shaderLoader.get('matrix-present'),
        'sceneColor'
    );

    // --- Pass declarations ---

    graphBuilder.addPass({
        name: 'simulation',
        writes: [instanceBuffer],
        execute: simulation.execute,
    });

    graphBuilder.addPass({
        name: 'draw',
        reads: [instanceBuffer],
        writes: [sceneColor],
        execute: draw.execute,
    });

    graphBuilder.addPass({
        name: 'present',
        reads: [sceneColor],
        execute: present.execute,
    });

    // --- Compile graph ---

    const renderGraph: CompiledRenderGraph = graphBuilder.compile();

    const renderTargets = new RenderTargetRegistry(
        gpu.device,
        graphBuilder.getTextureDescriptors(),
    );

    renderTargets.resize(size.width, size.height);

    // --- Render loop ---

    startRenderLoop(
        gpu.device,
        (encoder, dt) => ({
            encoder,
            dt,
            resources: renderTargets,
            acquireView: () => swapChain.getCurrentView(),
        }),
        (ctx) => {
            screen.update(gpu.device, canvas.width, canvas.height);
            renderGraph.execute(ctx);
        },
    );

    // --- Resize handling ---

    window.addEventListener('resize', () => {
        const next: CanvasSize = swapChain.resize();
        renderTargets.resize(next.width, next.height);
    });
}

bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal initialization error:', err);
});
