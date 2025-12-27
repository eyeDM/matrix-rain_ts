import { CanvasSize, CanvasResizer } from '../boot/canvas-resizer';

export interface SwapChain {
    /** Resize backing buffer and reconfigure if needed */
    resize(): CanvasSize;

    /** Acquire current frame view (always valid) */
    getCurrentView(): GPUTextureView | null;
}

export class SwapChainController implements SwapChain {
    private readonly resizer: CanvasResizer;

    constructor(
        canvas: HTMLCanvasElement,
        private readonly context: GPUCanvasContext,
        private readonly device: GPUDevice,
        private readonly format: GPUTextureFormat,
        private readonly alphaMode: GPUCanvasAlphaMode = 'opaque',
    ) {
        this.resizer = new CanvasResizer(canvas);
        this.configure(); // initial
    }

    private configure(): void {
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: this.alphaMode,
        });
    }

    // Call to (re)configure canvas size and reconfigure the context
    resize(): CanvasSize {
        const { size, changed } = this.resizer.resize();

        if (changed) {
            this.configure();
        }

        return size;
    }

    // Acquire the current texture view from the context
    getCurrentView(): GPUTextureView | null {
        try {
            return this.context.getCurrentTexture().createView();
        } catch {
            return null;
        }
    }
}
