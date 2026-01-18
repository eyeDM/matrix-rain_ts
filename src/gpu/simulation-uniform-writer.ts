import { SimulationUniformLayout } from '@backend/layouts';

/**
 * CPU-side writer for SimulationUniforms.
 * Owns the full layout and guarantees a single upload per frame.
 */
export class SimulationUniformWriter {
    private readonly staging: ArrayBuffer;
    private readonly view: DataView;

    constructor() {
        this.staging = new ArrayBuffer(SimulationUniformLayout.SIZE);
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
        cellHeight: number,
        maxTrail: number
    ): void {
        this.view.setUint32(SimulationUniformLayout.offsets.rows, rows, true);
        this.view.setUint32(SimulationUniformLayout.offsets.cols, cols, true);
        this.view.setUint32(SimulationUniformLayout.offsets.glyphCount, glyphCount, true);
        this.view.setFloat32(SimulationUniformLayout.offsets.cellWidth, cellWidth, true);
        this.view.setFloat32(SimulationUniformLayout.offsets.cellHeight, cellHeight, true);
        this.view.setUint32(SimulationUniformLayout.offsets.maxTrail, maxTrail, true);
    }

    /**
     * Write per-frame parameters.
     * Intended to be called once per frame.
     */
    writeFrame(dt: number): void {
        this.view.setFloat32(SimulationUniformLayout.offsets.dt, dt, true);
    }

    /**
     * Upload current staging contents to GPU.
     * Caller controls when GPU queue write is issued.
     */
    flush(queue: GPUQueue, buffer: GPUBuffer): void {
        queue.writeBuffer(buffer, 0, this.staging);
    }
}
