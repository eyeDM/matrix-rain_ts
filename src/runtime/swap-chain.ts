import { CanvasSize, CanvasResizer } from '@runtime/canvas-resizer';

export class SwapChain {
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

    /** Resize backing buffer and reconfigure the context if needed */
    resize(renderScale: number = 1.0): CanvasSize {
        const { size, changed } = this.resizer.resize(renderScale);

        if (changed) {
            this.configure();
        }

        return size;
    }

    /** Acquire the current texture view from the context */
    getCurrentView(): GPUTextureView {
        return this.context.getCurrentTexture().createView();
    }

    private configure(): void {
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: this.alphaMode,
        });
    }
}
