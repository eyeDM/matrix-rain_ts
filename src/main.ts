// Stage 1 bootstrap entry (strict TypeScript) — initialize WebGPU
import { initWebGPU } from './boot/webgpu-init';
import { startRenderLoop } from './engine/render-loop';

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
    // Device and context are ready — start the render loop for Stage 2.
    console.log('WebGPU initialized (Stage 1)', { device, format, context });

    // Start render loop (clears screen each frame)
    const stop = startRenderLoop(device, context, format);
    // Keep `stop` available via window for debugging if needed
    (window as any).__stopRenderLoop = stop;
  } catch (err) {
    console.error('Failed to initialize WebGPU:', err);
  }
}

bootstrap().catch((err) => console.error(err));
