// Stage 1 bootstrap entry (strict TypeScript) — initialize WebGPU
import { initWebGPU } from './boot/webgpu-init';
import { startRenderLoop } from './engine/render-loop';
import { createGlyphAtlas, createInstanceBuffer } from './engine/resources';
import { Renderer, createRenderer } from './engine/renderer';
import { RenderGraph, createRenderGraph } from './engine/render-graph';
import { createResourceManager } from './engine/resource-manager';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas element `#canvas` not found');
const canvasEl = canvas; // narrowed non-null reference for inner functions

// Constants (Per audit, used in instance count calculation)
const MAX_TRAIL = 250;

export async function bootstrap(): Promise<void> {
    try {
        const { device, context, format, configureCanvas } = await initWebGPU(canvasEl);

        // Resource manager for long-lived resources (glyph atlas, samplers)
        const persistentRM = createResourceManager(device);

        // Create a small glyph set and build an atlas
        const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*()'.split('');
        const glyphCount = glyphs.length;
        const atlas = await createGlyphAtlas(
            device,
            glyphs,
            { font: '32px monospace', padding: 8 }
        );

        // Tracking long-lived resources
        persistentRM.track(atlas.texture);
        persistentRM.track(atlas.sampler);
        persistentRM.track(atlas.glyphUVsBuffer);

        // Extract cell size from atlas
        const { cellWidth, cellHeight } = atlas;

        // Mutable state references
        let rendererRef: Renderer;
        let instancesBufRef: GPUBuffer;
        let currentCols: number;
        let currentRows: number;
        let renderGraphRef: RenderGraph;

        // Frame callback for the render loop
        const frameCallback = (
            commandEncoder: GPUCommandEncoder,
            currentView: GPUTextureView,
            dt: number
        ) => {
            renderGraphRef.execute(commandEncoder, currentView, dt);
        };

        const calcCanvasDims = (cellWidth: number, cellHeight: number) => {
            const dims = configureCanvas();

            const widthCSS = dims.width * dims.dpr;
            const heightCSS = dims.height * dims.dpr;

            return {
                cols: Math.floor(widthCSS / cellWidth),
                rows: Math.ceil(heightCSS / cellHeight),
            };
        };

        /**
         * Handles canvas resizing and re-initializes all size-dependent resources.
         */
        const handleResize = async () => {
            const newCanvasDims = calcCanvasDims(cellWidth, cellHeight);
            const newCols = newCanvasDims.cols;
            const newRows = newCanvasDims.rows;

            const newInstanceCount = newCols * MAX_TRAIL;

            if (newCols === currentCols && newRows === currentRows) return;

            // 1. Create NEW resources
            const newInstances = createInstanceBuffer(device, newInstanceCount);

            const newRenderer = await createRenderer(
                device,
                newCols,
                newRows,
                atlas.glyphUVsBuffer,
                newInstances,
                newInstanceCount,
                glyphCount,
                cellWidth,
                cellHeight,
                atlas.texture,
                atlas.sampler,
                canvasEl,
                format
            );

            // 2. Configure NEW Render Graph
            const newRenderGraph = createRenderGraph();
            newRenderGraph.addPass(newRenderer.computePass);
            newRenderGraph.addPass(newRenderer.drawPass);

            // 3. Save old references
            const oldRenderer = rendererRef!;
            const oldInstances = instancesBufRef!;
            // oldRenderGraph does not need to be destroyed since it does not own GPU resources

            // 4. Assign new references
            rendererRef = newRenderer;
            instancesBufRef = newInstances;
            renderGraphRef = newRenderGraph;
            currentCols = newCols;
            currentRows = newRows;

            // Wait for GPU to finish submitted work before destroying old buffers to avoid "buffer destroyed" errors
            try { await device.queue.onSubmittedWorkDone(); } catch (e) { /* ignore */ }

            // Now safe to destroy old resources
            try { oldInstances.destroy(); } catch (e) {}
            // Destroy renderer-owned GPU objects via the old renderer resource manager
            try { oldRenderer.destroy(); } catch (e) {}
        };

        // --- INITIALIZATION ---
        const currentDims = calcCanvasDims(cellWidth, cellHeight);
        currentCols = currentDims.cols;
        currentRows = currentDims.rows;

        const instanceCount = currentCols * MAX_TRAIL;

        instancesBufRef = createInstanceBuffer(device, instanceCount);

        rendererRef = await createRenderer(
            device,
            currentCols,
            currentRows,
            atlas.glyphUVsBuffer,
            instancesBufRef,
            instanceCount,
            glyphCount,
            cellWidth,
            cellHeight,
            atlas.texture,
            atlas.sampler,
            canvasEl,
            format
        );

        renderGraphRef = createRenderGraph();
        renderGraphRef.addPass(rendererRef.computePass);
        renderGraphRef.addPass(rendererRef.drawPass);
        // --- END INITIALIZATION ---

        // Start the main render loop
        startRenderLoop(device, context, frameCallback);

        // Debounced resize listener
        let resizeTimer: number | undefined;
        window.addEventListener('resize', () => {
            if (resizeTimer) cancelAnimationFrame(resizeTimer);
            // Use requestAnimationFrame for a safe debounced resize
            resizeTimer = requestAnimationFrame(() => { void handleResize(); resizeTimer = undefined; });
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to initialize WebGPU:', err);
    }
}

bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal initialization error in bootstrap:', err);
});
