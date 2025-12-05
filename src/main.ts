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

    // Create stream buffers for simulation (Stage 4): choose cols/rows conservatively
    const cols = 128;
    const rows = 64;
    const streams = createStreamBuffers(device, cols, rows);

    // Create renderer (loads compute shader and prepares pipelines)
    const renderer = await createRenderer(device, cols, rows, streams.params, streams.heads, streams.speeds, streams.lengths, streams.seeds, streams.columns);

    // Start render loop that calls renderer.encodeFrame each frame
    const stop = startRenderLoop(device, context, format, (encoder, currentView, dt) => {
      renderer.encodeFrame(encoder, currentView, dt);
    });
    (window as any).__stopRenderLoop = stop;
  } catch (err) {
    console.error('Failed to initialize WebGPU:', err);
  }
}

bootstrap().catch((err) => console.error(err));
