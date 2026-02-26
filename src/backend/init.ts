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

function pickDeviceLimits(adapter: GPUAdapter) {
    const limits = adapter.limits;

    // Upper reasonable bound for instance storage
    const TARGET_MAX_BUFFER = 512 * 1024 * 1024; // 512 MiB

    return {
        maxBufferSize: Math.min(limits.maxBufferSize, TARGET_MAX_BUFFER),
    };
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

    const device = await adapter.requestDevice({
        requiredLimits: pickDeviceLimits(adapter),
    });

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

/**
 * Displays a full-screen fallback message when WebGPU is not available.
 * This uses standard DOM/CSS and does not rely on GPU features.
 */
export function showWebGPUNotSupported(): void {
    // Avoid duplicating overlay if called multiple times
    if (document.getElementById('webgpu-fallback')) {
        return;
    }

    const container = document.createElement('div');
    container.id = 'webgpu-fallback';

    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.background = '#000';
    container.style.color = '#00ff99';
    container.style.fontFamily = 'monospace';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.padding = '24px';
    container.style.textAlign = 'center';
    container.style.zIndex = '9999';

    container.innerHTML = `
        <h1 style="font-size: 20px; margin-bottom: 16px;">
            WebGPU is not supported in this browser
        </h1>
        <p style="max-width: 480px; line-height: 1.4; margin-bottom: 16px;">
            This visualization requires WebGPU, which is not available in your current browser.
        </p>
        <p style="max-width: 480px; line-height: 1.4;">
            Recommended browsers:
        </p>
        <ul style="list-style: none; padding: 0; margin: 12px 0 0 0;">
            <li>• Google Chrome (latest version)</li>
            <li>• Microsoft Edge (latest version)</li>
            <li>• Chromium-based browsers with WebGPU enabled</li>
        </ul>
    `;

    document.body.appendChild(container);
}
