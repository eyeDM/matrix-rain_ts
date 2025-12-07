// Stage 1 bootstrap entry (strict TypeScript) — initialize WebGPU
import { initWebGPU } from './boot/webgpu-init';
import { startRenderLoop } from './engine/render-loop';
import { createGlyphAtlas } from './engine/resources';
import { createStreamBuffers } from './sim/streams';
import { createRenderer } from './engine/renderer';
import { createRenderGraph } from './engine/render-graph';
import { createResourceManager } from './engine/resource-manager';

const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas element #gpu-canvas not found');
const canvasEl = canvas; // narrowed non-null reference for inner functions

export async function bootstrap(): Promise<void> {
  try {
    const { device, context, format, configureCanvas } = await initWebGPU(canvasEl);

    // Create resource managers:
    // - `persistentRM` for long-lived resources (glyph atlas, samplers)
    // - `rendererRM` will be created per-renderer generation and destroyed on resize
    const persistentRM = createResourceManager(device);

    // Create a small glyph set and build an atlas (Stage 3 usage)
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*()'.split('');
    const atlas = await createGlyphAtlas(device, glyphs, { font: '28px monospace', padding: 6 }, persistentRM);

    // Extract cell size from atlas (assume uniform cell size)
    const firstIter = atlas.glyphMap.values().next();
    if (firstIter.done) throw new Error('Atlas glyphMap is empty');
    const first = firstIter.value;
    const cellW = first.width;
    const cellH = first.height;

    // Create stream buffers for simulation (Stage 4): choose cols/rows conservatively
    const cols = 128;
    const rows = 64;
    const streams = createStreamBuffers(device, cols, rows, glyphs.length, cellW, cellH);

    // Create glyph UV buffer (array of vec4<u32> normalized UV rects) in glyph order
    const glyphCount = glyphs.length;
    const glyphUVData = new Float32Array(glyphCount * 4);
    for (let i = 0; i < glyphCount; i++) {
      const uv = atlas.glyphMap.get(glyphs[i])!;
      glyphUVData[i * 4 + 0] = uv.u0;
      glyphUVData[i * 4 + 1] = uv.v0;
      glyphUVData[i * 4 + 2] = uv.u1;
      glyphUVData[i * 4 + 3] = uv.v1;
    }

    const glyphUVsBuffer = device.createBuffer({
      size: glyphUVData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(glyphUVsBuffer, 0, glyphUVData.buffer);

    // Instances buffer: reserve a fixed number of trail samples per column
    const MAX_TRAIL = 32; // must match compute shader
    const instanceSize = 48; // bytes (matches InstanceOut struct in WGSL: 48 bytes)
    const instanceCount = cols * MAX_TRAIL;
    const instancesBuffer = device.createBuffer({
      size: instanceCount * instanceSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // Create renderer (loads compute shader and prepares pipelines)
    let rendererRM = createResourceManager(device);
    const renderer = await createRenderer(
      device,
      cols,
      rows,
      streams.params,
      streams.paramsStaging,
      streams.heads,
      streams.speeds,
      streams.lengths,
      streams.seeds,
      streams.columns,
      glyphUVsBuffer,
      instancesBuffer,
      instanceCount,
      glyphCount,
      cellW,
      cellH,
      atlas.texture,
      atlas.sampler,
      canvasEl,
      format,
      rendererRM
    );

    // Prepare dynamic references so renderer can be hot-swapped on resize
    let rendererRef = renderer;
    let streamsRef = streams;
    let instancesBufRef = instancesBuffer;
    let currentCols = cols;
    let currentRows = rows;

    // Build a simple render graph and register the renderer as separate compute/draw passes
    const graph = createRenderGraph();

    // Compute pass (no dependencies)
    graph.addPass({
      name: 'compute',
      kind: 'compute',
      deps: [],
      execute: (encoder, _currentView, dt) => {
        // dynamic reference ensures hot-swap on resize works
        rendererRef.compute.encode(encoder, dt);
      }
    });

    // Draw pass depends on compute
    graph.addPass({
      name: 'draw',
      kind: 'draw',
      deps: ['compute'],
      execute: (encoder, currentView, dt) => {
        rendererRef.draw.encode(encoder, currentView, dt);
      }
    });

    const stop = startRenderLoop(device, context, format, (encoder, currentView, dt) => {
      // Execute declarative render graph (ordered by dependencies)
      graph.execute(encoder, currentView, dt);
    });
    (window as any).__stopRenderLoop = stop;
    // Resize handling: use `configureCanvas` from init to reconfigure the canvas/context
    const handleResize = async () => {
      // ensure canvas backing buffer matches CSS size and context is reconfigured
      const { width: backingWidth, height: backingHeight } = configureCanvas();

      const newCols = Math.max(1, Math.floor(backingWidth / cellW));
      const newRows = Math.max(1, Math.floor(backingHeight / cellH));
      if (newCols === currentCols && newRows === currentRows) return;

      // Recreate buffers and renderer with new grid size first
      const newStreams = createStreamBuffers(device, newCols, newRows, glyphCount, cellW, cellH);
      const newInstanceCount = newCols * MAX_TRAIL;
      const newInstances = device.createBuffer({ size: newInstanceCount * instanceSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
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
        glyphUVsBuffer,
        newInstances,
        newInstanceCount,
        glyphCount,
        cellW,
        cellH,
        atlas.texture,
        atlas.sampler,
        canvasEl,
        format,
        newRendererRM
      );

      // Keep references to old resources so we can destroy them after GPU is idle
      const oldStreams = streamsRef;
      const oldInstances = instancesBufRef;
      const oldRenderer = rendererRef;
      const oldRendererRM = rendererRM;

      // swap refs so render loop begins using new resources immediately
      rendererRef = newRenderer;
      rendererRM = newRendererRM;
      streamsRef = newStreams;
      instancesBufRef = newInstances;
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

    // Debounced resize listener (single listener)
    let resizeTimer: number | undefined;
    window.addEventListener('resize', () => {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(() => { void handleResize(); resizeTimer = undefined; });
    });
  } catch (err) {
    console.error('Failed to initialize WebGPU:', err);
  }
}

bootstrap().catch((err) => console.error(err));
