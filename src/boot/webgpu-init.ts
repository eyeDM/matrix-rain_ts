/**
 * Initialize WebGPU module
 *
 * Responsibilities:
 * 1. Request GPU adapter and device.
 * 2. Get and configure the GPUCanvasContext.
 * 3. Provide a `configureCanvas` helper for handling HiDPI and resizing.
 */

export interface WebGPUContext {
    readonly device: GPUDevice;
    readonly context: GPUCanvasContext;
    readonly format: GPUTextureFormat;
}

/**
 * Initialize WebGPU: request adapter & device, get canvas context,
 * detect preferred format and configure the swap chain.
 *
 * @param canvas - HTMLCanvasElement to attach the WebGPU context to.
 * @returns device, context and preferred format, plus the configuration helper.
 */
export async function initWebGPU(
    canvas: HTMLCanvasElement
): Promise<WebGPUContext> {
    if (!navigator.gpu) {
        throw new Error('WebGPU not supported.');
    }

    // Request a high-performance adapter
    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
    });

    if (!adapter) {
        throw new Error('Couldn\'t request WebGPU adapter.');
    }

    // No optional features required for Stage 1. Keep explicit list here for future use.
    const requiredFeatures: GPUFeatureName[] = [];
    const device = await adapter.requestDevice({ requiredFeatures });

    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) {
        throw new Error('Failed to acquire GPUCanvasContext from the provided canvas.');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();

    return {
        device,
        context,
        format,
    };
}
