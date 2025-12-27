export type CanvasSize = {
    width: number;
    height: number;
    dpr: number;
}

export type ResizeResult = {
    size: CanvasSize;
    changed: boolean;
};

export class CanvasResizer {
    private last: CanvasSize | null = null;

    constructor(private readonly canvas: HTMLCanvasElement) {}

    resize(): ResizeResult {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
        const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));

        const changed =
            !this.last
            || width !== this.last.width
            || height !== this.last.height
            || dpr !== this.last.dpr;

        if (changed) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.last = { width, height, dpr };
        }

        return { size: this.last!, changed };
    }
}
