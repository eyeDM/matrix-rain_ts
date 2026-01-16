// Bootstrap entry — initialize WebGPU

import { SwapChainController } from '@runtime/swap-chain';
import { startRenderLoop } from '@runtime/render-loop';
import { CanvasSize } from '@runtime/canvas-resizer';

import { AtlasResult, createGlyphAtlas } from '@engine/render/resources';
import { ScreenUniformController } from '@engine/render/screen-uniform-controller';
import { SimulationPassBuilder } from '@engine/simulation/simulation-pass';
import { DrawPassBuilder } from '@engine/render/draw-pass';
import { PresentPassBuilder } from '@engine/render/present-pass';
import { RenderContext, RenderGraphBuilder, RenderGraph } from '@engine/render/render-graph';

import { InstanceLayout } from '@platform/webgpu/layouts';
import { WebGPUContext, initWebGPU } from '@platform/webgpu/init';
import { ShaderLoader } from '@platform/webgpu/shader-loader';
import { ResourceRegistry } from '@platform/webgpu/resource-registry';
import { ResourceManager } from '@platform/webgpu/resource-manager';

const COLOR_FORMAT: GPUTextureFormat = 'rgba16float'; // 'bgra8unorm'
//const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

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

function buildRegistry(layout: ScreenLayout): ResourceRegistry {
    const registry = new ResourceRegistry();

    /**
     * Define a GPU buffer specifically for holding instance data (InstanceData[] in WGSL).
     * This buffer acts as the output target for the Compute Shader and the input source
     * for the Render (Draw) Shader.
     */
    registry.addBuffer('InstanceBuffer', {
        size: layout.instances.count * InstanceLayout.SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
    });

    /*registry.addBuffer('FrameUniforms', {
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });*/

    /*const sceneColor = resources.declareTexture({
        name: 'SceneColor',
        desc: {
            format: COLOR_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            size: { width: size.width, height: size.height }
        },
        recreateOnResize: true
    });*/

    registry.addTexture('SceneColor', {
        size: [layout.viewport.width, layout.viewport.height],
        format: COLOR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        //usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    /*registry.addTexture('DepthTarget', {
        size: [size.width, size.height],
        format: DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });*/

    /*registry.addSampler('LinearClampSampler', {
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });*/

    registry.freeze(); // make registry immutable

    return registry;
}

/**
 * FIXME: *PassBuilder создают destroyable GPU-ресурсы,
 * часть из которых зависит от текущего размера экрана.
 * При resize их следует уничтожать и создавать заново.
 */
function buildRenderGraph(
    gpu: WebGPUContext,
    shaderLoader: ShaderLoader,
    atlas: AtlasResult,
    layout: ScreenLayout,
    screenBuffer: GPUBuffer,
): RenderGraph {
    const graphBuilder = new RenderGraphBuilder();

    // --- Pass declarations ---

    const SimulationPass = new SimulationPassBuilder(
        gpu.device,
        shaderLoader.get('matrix-compute'),
        atlas.glyphUVsBuffer,
        atlas.glyphCount,
        atlas.cellWidth,
        atlas.cellHeight,
        'InstanceBuffer',
    )

    graphBuilder.addPass(
        SimulationPass.build(layout.grid.cols, layout.grid.rows, layout.instances.maxTrail)
    );

    const DrawPass = new DrawPassBuilder(
        gpu.device,
        shaderLoader.get('matrix-draw'),
        atlas.texture,
        atlas.sampler,
        COLOR_FORMAT,
        //DEPTH_FORMAT,
        'InstanceBuffer',
        'SceneColor',
    );

    graphBuilder.addPass(
        DrawPass.build(screenBuffer, layout.instances.count)
    );

    const PresentPass = new PresentPassBuilder(
        gpu.device,
        gpu.format,
        shaderLoader.get('matrix-present'),
        'SceneColor',
    );

    graphBuilder.addPass(
        PresentPass.build()
    );

    return graphBuilder.build();
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

    screen.update(gpu.device, layout.viewport.width, layout.viewport.height);

    // --- Resource declaration ---

    const registry: ResourceRegistry = buildRegistry(layout);

    let resources = new ResourceManager(gpu.device, registry);

    // --- Render Graph ---

    let renderGraph: RenderGraph = buildRenderGraph(
        gpu,
        shaderLoader,
        atlas,
        layout,
        screen.buffer,
    );

    // --- Render loop ---

    function makeRenderContext(
        encoder: GPUCommandEncoder,
        dt: number
    ): RenderContext {
        return {
            device: gpu.device,
            encoder,
            resources,
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

        screen.update(gpu.device, layout.viewport.width, layout.viewport.height);

        resources.destroyAll();
        const newRegistry = buildRegistry(layout);

        resources = new ResourceManager(gpu.device, newRegistry);

        renderGraph = buildRenderGraph(
            gpu,
            shaderLoader,
            atlas,
            layout,
            screen.buffer,
        );
    });
}

bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal initialization error:', err);
});
