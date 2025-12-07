export type WebGPUInitResult = {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
};

/**
 * Initialize WebGPU: request adapter & device, get canvas context,
 * detect preferred format and configure the swap chain.
 *
 * @param canvas - HTMLCanvasElement to attach the WebGPU context to.
 * @returns device, context and preferred format.
 */
export type WebGPUInitExtended = WebGPUInitResult & {
  // Call to (re)configure canvas size and reconfigure the context
  configureCanvas: () => { width: number; height: number; dpr: number };
  canvas: HTMLCanvasElement;
};

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUInitExtended> {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU not supported in this browser (navigator.gpu missing). Use Firefox 145+ or Chrome with WebGPU enabled.');
  }

  const adapter = await (navigator as any).gpu.requestAdapter({ powerPreference: 'high-performance' }) as GPUAdapter | null;
  if (!adapter) {
    throw new Error('Failed to request GPU adapter.');
  }

  // No optional features required for Stage 1. Keep explicit list here for future use.
  const requiredFeatures: GPUFeatureName[] = [];
  const device = await adapter.requestDevice({ requiredFeatures });

  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) {
    throw new Error('Failed to acquire GPUCanvasContext from the provided canvas.');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  // Helper to size the canvas backing buffer for HiDPI and reconfigure the context.
  function configureCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // Reconfigure the context. Calling configure on resize is safe and recommended.
    context!.configure({ device, format, alphaMode: 'opaque' });

    return { width: canvas.width, height: canvas.height, dpr };
  }

  // Initial configuration
  configureCanvas();

  return { device, context, format, configureCanvas, canvas };
}
