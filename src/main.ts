// Stage 1 bootstrap entry (strict TypeScript) — initialize WebGPU
import { initWebGPU } from './boot/webgpu-init';
import { startRenderLoop } from './engine/render-loop';
import { createGlyphAtlas, createInstanceBuffer } from './engine/resources';
import { StreamBuffers, createStreamBuffers } from './sim/streams';
import { Renderer, createRenderer } from './engine/renderer';
import { RenderGraph, createRenderGraph } from './engine/render-graph';
import { ResourceManager, createResourceManager } from './engine/resource-manager';

const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas element #gpu-canvas not found');
const canvasEl = canvas; // narrowed non-null reference for inner functions

// Constants (Per audit, used in instance count calculation)
const MAX_TRAIL = 250;

export async function bootstrap(): Promise<void> {
  try {
    const { device, context, format, configureCanvas } = await initWebGPU(canvasEl);

    // Create resource managers:
    // - `persistentRM` for long-lived resources (glyph atlas, samplers)
    // - `rendererRM` will be created per-renderer generation and destroyed on resize
    const persistentRM = createResourceManager(device);

    // Create a small glyph set and build an atlas (Stage 3 usage)
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*()'.split('');
    const glyphCount = glyphs.length;
    const atlas = await createGlyphAtlas(device, glyphs, { font: '28px monospace', padding: 6 });

    // Tracking long-lived resources
    persistentRM.track(atlas.texture);
    persistentRM.track(atlas.sampler);
    persistentRM.track(atlas.glyphUVsBuffer);

    // Extract cell size from atlas
    const { cellWidth, cellHeight } = atlas;

    // Mutable state references
    let rendererRef: Renderer;
    let rendererRM: ResourceManager;
    let streamsRef: StreamBuffers;
    let instancesBufRef: GPUBuffer;
    let currentCols: number;
    let currentRows: number;
    let renderGraphRef: RenderGraph;

    // Frame callback for the render loop
    const frameCallback = (commandEncoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) => {
      renderGraphRef.execute(commandEncoder, currentView, dt);
    };

    /**
     * Handles canvas resizing and re-initializes all size-dependent resources.
     */
    const handleResize = async () => {
      const { width: newWidth, height: newHeight } = configureCanvas();
      const newCols = Math.floor(newWidth / cellWidth);
      const newRows = Math.ceil(newHeight / cellHeight);
      const newInstanceCount = newCols * MAX_TRAIL;

      if (newCols === currentCols && newRows === currentRows) return;

      // 1. Create NEW resources
      const newStreams = createStreamBuffers(device, newCols, newRows, glyphCount, cellWidth, cellHeight);
      const newInstances = createInstanceBuffer(device, newInstanceCount);

      // Create a fresh resource manager for the new renderer's internal resources
      const newRendererRM = createResourceManager(device);
      const newRenderer = await createRenderer(
        device,
        newCols,
        newRows,
        newStreams.params,
        newStreams.paramsStaging,
        newStreams.heads,
        newStreams.speeds,
        newStreams.lengths,
        newStreams.seeds,
        newStreams.columns,
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
      const oldRendererRM = rendererRM!;
      const oldStreams = streamsRef!;
      const oldInstances = instancesBufRef!;
      // oldRenderGraph не нужно уничтожать, так как он не владеет GPU ресурсами.

      // 4. Assign new references
      rendererRef = newRenderer;
      rendererRM = newRendererRM;
      streamsRef = newStreams;
      instancesBufRef = newInstances;
      renderGraphRef = newRenderGraph;
      currentCols = newCols;
      currentRows = newRows;

      // Wait for GPU to finish submitted work before destroying old buffers to avoid "buffer destroyed" errors
      try { await device.queue.onSubmittedWorkDone(); } catch (e) { /* ignore */ }

      // Now safe to destroy old resources
      try { oldStreams.heads.destroy(); } catch (e) {}
      try { oldStreams.speeds.destroy(); } catch (e) {}
      try { oldStreams.lengths.destroy(); } catch (e) {}
      try { oldStreams.seeds.destroy(); } catch (e) {}
      try { oldStreams.columns.destroy(); } catch (e) {}
      try { oldStreams.params.destroy(); } catch (e) {}
      try { oldInstances.destroy(); } catch (e) {}
      // Destroy renderer-owned GPU objects via the old renderer resource manager
      try { oldRendererRM.destroyAll(); } catch (e) {}
      try { oldRenderer.destroy(); } catch (e) {}
    };

    // --- INITIALIZATION ---
    const initialDims = configureCanvas();
    currentCols = Math.floor(initialDims.width / cellWidth);
    currentRows = Math.ceil(initialDims.height / cellHeight);
    const instanceCount = currentCols * MAX_TRAIL;

    // Create streams and instance buffers
    streamsRef = createStreamBuffers(device, currentCols, currentRows, glyphCount, cellWidth, cellHeight);
    instancesBufRef = createInstanceBuffer(device, instanceCount);

    // Create initial renderer and resource manager
    rendererRM = createResourceManager(device);
    rendererRef = await createRenderer(
      device,
      currentCols,
      currentRows,
      streamsRef.params,
      streamsRef.paramsStaging,
      streamsRef.heads,
      streamsRef.speeds,
      streamsRef.lengths,
      streamsRef.seeds,
      streamsRef.columns,
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

    // INITIAL RENDER GRAPH SETUP
    renderGraphRef = createRenderGraph();
    renderGraphRef.addPass(rendererRef.computePass);
    renderGraphRef.addPass(rendererRef.drawPass);
    // --- END INITIALIZATION ---

    // Start the main render loop
    startRenderLoop(device, context, format, frameCallback);

    //console.log('Canvas dimensions:', canvasEl.width, 'x', canvasEl.height);
    //console.log('Cell size:', cellWidth, 'x', cellHeight);
    //console.log('Grid:', currentCols, 'cols x', currentRows, 'rows');
    //console.log('Instance count:', instanceCount);
    //console.log('Expected coverage:', currentCols * cellWidth, 'pixels');

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
