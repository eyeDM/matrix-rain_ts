/**
 * Initialize WebGPU module
 *
 * Responsibilities:
 * 1. Request GPU adapter and device.
 * 2. Get and configure the GPUCanvasContext.
 * 3. Provide a `configureCanvas` helper for handling HiDPI and resizing.
 */

export type WebGPUInitResult = {
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
};

export type WebGPUInitExtended = WebGPUInitResult & {
    // Call to (re)configure canvas size and reconfigure the context
    configureCanvas: () => { width: number; height: number; dpr: number };
    canvas: HTMLCanvasElement;
};

/**
 * Initialize WebGPU: request adapter & device, get canvas context,
 * detect preferred format and configure the swap chain.
 *
 * @param canvas - HTMLCanvasElement to attach the WebGPU context to.
 * @returns device, context and preferred format, plus the configuration helper.
 */
export async function initWebGPU(
    canvas: HTMLCanvasElement
): Promise<WebGPUInitExtended> {
    if (!('gpu' in navigator)) {
        throw new Error('WebGPU not supported in this browser (navigator.gpu missing). Use Firefox 145+ or Chrome with WebGPU enabled.');
    }

    // Request a high-performance adapter
    const adapter = await (navigator as any).gpu.requestAdapter({
        powerPreference: 'high-performance'
    });

    if (!adapter) {
        throw new Error('Failed to acquire GPU adapter.');
    }

    // No optional features required for Stage 1. Keep explicit list here for future use.
    const requiredFeatures: GPUFeatureName[] = [];
    const device = await adapter.requestDevice({ requiredFeatures });

    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) {
        throw new Error('Failed to acquire GPUCanvasContext from the provided canvas.');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();

    // Cached configuration state (physical pixels)
    let lastWidth = 0;
    let lastHeight = 0;
    let lastDpr = 0;

    // Helper to size the canvas backing buffer for HiDPI and reconfigure the context.
    function configureCanvas() {
        const dpr = window.devicePixelRatio || 1;
        // Calculate new size based on CSS client size and DPR, ensuring minimum size of 1
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

        const sizeChanged =
            width !== lastWidth ||
            height !== lastHeight ||
            dpr !== lastDpr;

        if (sizeChanged) {
            canvas.width = width;
            canvas.height = height;

            // NOTE: 'opaque' is suitable for clearing the background to black,
            // preventing alpha issues.
            context!.configure({
                device,
                format,
                alphaMode: 'opaque',
            });

            lastWidth = width;
            lastHeight = height;
            lastDpr = dpr;
        }

        return { width, height, dpr };
    }

    // Initial configuration must be called once before the render loop starts
    configureCanvas();

    return {
        device,
        context,
        format,
        configureCanvas,
        canvas,
    };
}
