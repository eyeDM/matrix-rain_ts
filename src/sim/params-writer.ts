import { ParamsLayout } from '../gpu/layouts';

/**
 * CPU-side writer for Params uniform buffer.
 * Owns all knowledge about ParamsLayout packing.
 */
export class ParamsWriter {
    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor() {
        this.staging = new ArrayBuffer(ParamsLayout.SIZE);
        this.view = new DataView(this.staging);
    }

    /**
     * Write all static (rarely changing) parameters.
     * Intended for init-time or resize-time updates.
     */
    writeStatic(
        rows: number,
        cols: number,
        glyphCount: number,
        cellWidth: number,
        cellHeight: number
    ): void {
        this.view.setUint32(ParamsLayout.offsets.rows, rows, true);
        this.view.setUint32(ParamsLayout.offsets.cols, cols, true);
        this.view.setUint32(ParamsLayout.offsets.glyphCount, glyphCount, true);
        this.view.setFloat32(ParamsLayout.offsets.cellWidth, cellWidth, true);
        this.view.setFloat32(ParamsLayout.offsets.cellHeight, cellHeight, true);
    }

    /**
     * Write per-frame parameters.
     * Intended to be called once per frame.
     */
    writeFrame(dt: number): void {
        this.view.setFloat32(ParamsLayout.offsets.dt, dt, true);
    }

    /**
     * Upload current staging contents to GPU.
     * Caller controls when GPU queue write is issued.
     */
    flush(queue: GPUQueue, buffer: GPUBuffer): void {
        queue.writeBuffer(buffer, 0, this.staging);
    }
}
