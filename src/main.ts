// Stage 0 bootstrap entry (strict TypeScript)
const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas element #gpu-canvas not found');
}

function resizeCanvasToDisplaySize(): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

resizeCanvasToDisplaySize();
window.addEventListener('resize', resizeCanvasToDisplaySize);

export async function bootstrap(): Promise<void> {
  // Placeholder for Stage 1 WebGPU initialization
  console.log('Bootstrap complete (Stage 0)');
}

bootstrap().catch((err) => console.error(err));
