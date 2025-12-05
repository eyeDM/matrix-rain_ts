// Stage 1 bootstrap entry (strict TypeScript) — initialize WebGPU
import { initWebGPU } from './boot/webgpu-init';
import { startRenderLoop } from './engine/render-loop';
import { createGlyphAtlas } from './engine/resources';
import { createStreamBuffers } from './sim/streams';
import { createRenderer } from './engine/renderer';

const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas element #gpu-canvas not found');
}
const canvasEl = canvas; // narrowed non-null reference for inner functions

function resizeCanvasToDisplaySize(): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(canvasEl.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvasEl.clientHeight * dpr));
  if (canvasEl.width !== width || canvasEl.height !== height) {
    canvasEl.width = width;
    canvasEl.height = height;
  }
}

resizeCanvasToDisplaySize();
window.addEventListener('resize', resizeCanvasToDisplaySize);

export async function bootstrap(): Promise<void> {
  try {
    const { device, context, format } = await initWebGPU(canvasEl);
    console.log('WebGPU initialized (Stage 1)', { device, format, context });

    // Create a small glyph set and build an atlas (Stage 3 usage)
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*()'.split('');
    const atlas = await createGlyphAtlas(device, glyphs, { font: '28px monospace', padding: 6 });

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

    // Instances buffer: one instance per column (head instance)
    const instanceSize = 32; // bytes (matches InstanceOut struct in WGSL)
    const instancesBuffer = device.createBuffer({
      size: cols * instanceSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // Create renderer (loads compute shader and prepares pipelines)
    const renderer = await createRenderer(
      device,
      cols,
      rows,
      streams.params,
      streams.heads,
      streams.speeds,
      streams.lengths,
      streams.seeds,
      streams.columns,
      glyphUVsBuffer,
      instancesBuffer,
      glyphCount,
      cellW,
      cellH,
      atlas.texture,
      atlas.sampler,
      canvasEl,
      format
    );

    // Start render loop that calls renderer.encodeFrame each frame
    let rendererRef = renderer;
    let streamsRef = streams;
    let instancesBufRef = instancesBuffer;
    let currentCols = cols;
    let currentRows = rows;

    const stop = startRenderLoop(device, context, format, (encoder, currentView, dt) => {
      // dynamic reference to allow hot-swap on resize
      rendererRef.encodeFrame(encoder, currentView, dt);
    });
    (window as any).__stopRenderLoop = stop;

    // Resize handling: reconfigure canvas and, if grid dims changed, recreate simulation buffers and renderer
    const handleResize = async () => {
      try {
        // reconfigure canvas backing buffer and swap chain
        (await import('./boot/webgpu-init')).initWebGPU; // noop to satisfy bundler; we have configure from init result
        // call configureCanvas from the init result by re-querying init (we have context from earlier)
        // Actually we kept no reference to configureCanvas; call context.configure via initWebGPU again isn't necessary.
      } catch (e) {
        // ignore
      }
      // ensure canvas backing buffer matches CSS size
      const dpr = window.devicePixelRatio || 1;
      const newWidth = Math.max(1, Math.floor(canvasEl.clientWidth * dpr));
      const newHeight = Math.max(1, Math.floor(canvasEl.clientHeight * dpr));
      if (canvasEl.width !== newWidth || canvasEl.height !== newHeight) {
        canvasEl.width = newWidth;
        canvasEl.height = newHeight;
        // reconfigure the context to be safe
        try {
          context.configure({ device, format, alphaMode: 'opaque' });
        } catch (e) {
          // some browsers may complain; ignore
        }
      }

      const newCols = Math.max(1, Math.floor(canvasEl.width / cellW));
      const newRows = Math.max(1, Math.floor(canvasEl.height / cellH));
      if (newCols === currentCols && newRows === currentRows) return;

      // Recreate buffers and renderer with new grid size first
      const newStreams = createStreamBuffers(device, newCols, newRows, glyphCount, cellW, cellH);
      const newInstances = device.createBuffer({ size: newCols * instanceSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const newRenderer = await createRenderer(
        device,
        newCols,
        newRows,
        newStreams.params,
        newStreams.heads,
        newStreams.speeds,
        newStreams.lengths,
        newStreams.seeds,
        newStreams.columns,
        glyphUVsBuffer,
        newInstances,
        glyphCount,
        cellW,
        cellH,
        atlas.texture,
        atlas.sampler,
        canvasEl,
        format
      );

      // Keep references to old resources so we can destroy them after GPU is idle
      const oldStreams = streamsRef;
      const oldInstances = instancesBufRef;
      const oldRenderer = rendererRef;

      // swap refs so render loop begins using new resources immediately
      rendererRef = newRenderer;
      streamsRef = newStreams;
      instancesBufRef = newInstances;
      currentCols = newCols;
      currentRows = newRows;

      // Wait for GPU to finish submitted work before destroying old buffers to avoid "buffer destroyed" errors
      try {
        await device.queue.onSubmittedWorkDone();
      } catch (e) {
        // ignore
      }

      // Now safe to destroy old resources
      try { oldStreams.heads.destroy(); } catch (e) {}
      try { oldStreams.speeds.destroy(); } catch (e) {}
      try { oldStreams.lengths.destroy(); } catch (e) {}
      try { oldStreams.seeds.destroy(); } catch (e) {}
      try { oldStreams.columns.destroy(); } catch (e) {}
      try { oldStreams.params.destroy(); } catch (e) {}
      try { oldInstances.destroy(); } catch (e) {}
      try { oldRenderer.destroy(); } catch (e) {}
    };

    // Debounced resize listener
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
