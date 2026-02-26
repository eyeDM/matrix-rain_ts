/**
 * Initialize WebGPU module
 *
 * Responsibilities:
 * 1. Request GPU adapter and logical device.
 * 2. Acquire GPUCanvasContext from the provided canvas.
 * 3. Resolve the preferred swapchain texture format.
 * 4. Apply conservative device limits for predictable memory usage.
 * 5. Provide a minimal, stable context bundle used by the rest of the renderer.
 *
 * Design notes:
 * - This module does NOT create pipelines or GPU resources beyond the device.
 * - All higher-level GPU resources must be created by dedicated subsystems.
 * - The function fails fast on any unsupported or invalid state to avoid
 *   partially initialized GPU pipelines.
 *
 * Failure modes:
 * - navigator.gpu missing → WebGPU not supported in current browser
 * - adapter acquisition fails → no compatible GPU backend available
 * - device creation fails → limits/features not supported
 * - context acquisition fails → canvas is incompatible or lost
 *
 * Consumers are expected to catch errors and use a graceful fallback UI.
 */

export interface WebGPUContext {
    /** Logical GPU device used for all resource creation and command submission */
    readonly device: GPUDevice;

    /** Canvas context used as presentation surface (swapchain target) */
    readonly context: GPUCanvasContext;

    /** Preferred GPU texture format for the presentation surface */
    readonly format: GPUTextureFormat;
}

/**
 * Select a safe subset of device limits.
 *
 * Rationale:
 * Some mobile/low-end GPUs report extremely large theoretical limits which
 * may lead to unstable allocations or memory pressure in real-world usage.
 * We clamp critical limits to a conservative upper bound.
 *
 * Currently constrained:
 * - maxBufferSize: capped to 512 MiB to prevent excessive allocations for
 *   storage buffers (e.g., column state buffers).
 */
function pickDeviceLimits(adapter: GPUAdapter) {
    const limits = adapter.limits;

    // Upper reasonable bound for instance/storage buffers (512 MiB)
    const TARGET_MAX_BUFFER = 512 * 1024 * 1024;

    return {
        maxBufferSize: Math.min(limits.maxBufferSize, TARGET_MAX_BUFFER),
    };
}

/**
 * Initialize WebGPU: request adapter & device, get canvas context,
 * detect preferred presentation format.
 *
 * @param canvas - HTMLCanvasElement used as rendering surface.
 *
 * @returns WebGPUContext
 *
 * @throws Error if WebGPU is unavailable or initialization fails.
 */
export async function initWebGPU(
    canvas: HTMLCanvasElement
): Promise<WebGPUContext> {
    // Feature detection — required for graceful degradation
    if (!navigator.gpu) {
        throw new Error('WebGPU not supported.');
    }

    // Request a high-performance adapter (discrete GPU preferred where available)
    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
    });

    if (!adapter) {
        throw new Error('Couldn\'t request WebGPU adapter.');
    }

    // Create logical device with constrained limits
    const device = await adapter.requestDevice({
        requiredLimits: pickDeviceLimits(adapter),
    });

    // Acquire WebGPU canvas context
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;

    if (!context) {
        throw new Error(
            'Failed to acquire GPUCanvasContext from the provided canvas.'
        );
    }

    // Resolve preferred presentation format for current platform/browser
    const format = navigator.gpu.getPreferredCanvasFormat();

    return {
        device,
        context,
        format,
    };
}

/**
 * Displays a full-screen fallback message when WebGPU is not available.
 *
 * This is used as a graceful degradation path for browsers that:
 * - do not implement WebGPU (e.g. iOS Safari),
 * - have it disabled,
 * - or fail adapter/device initialization.
 *
 * The overlay is intentionally:
 * - pure DOM/CSS (no GPU dependency),
 * - idempotent (safe to call multiple times),
 * - visually aligned with the Matrix theme.
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
