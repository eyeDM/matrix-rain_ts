import { GlyphGridParamsLayout } from '@backend/layouts';
import { GpuResourceScope } from '@backend/resource-tracker';

export type GlyphGridParams = {
    cellWidth: number;
    cellHeight: number;
    atlasWidth: number;
    atlasHeight: number;
    glyphCount: number;

    cols: number;
    rows: number;
    maxTrail: number;
}

export class GlyphGridParamsWriter {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly viewF32: Float32Array;
    private readonly viewU32: Uint32Array;

    constructor(
        private readonly device: GPUDevice,
        scope: GpuResourceScope,
    ) {
        this.buffer = scope.trackDestroyable(
            device.createBuffer({
                label: 'DrawParams Uniform Buffer',
                size: GlyphGridParamsLayout.SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(GlyphGridParamsLayout.SIZE);
        this.viewF32 = new Float32Array(this.staging);
        this.viewU32 = new Uint32Array(this.staging);
    }

    /**
     * Set all Surface-Lifetime parameters.
     * Intended for init-time or resize-time updates.
     */
    set(params: GlyphGridParams): void {
        this.viewF32[GlyphGridParamsLayout.offsets.cellSize / 4] =
            params.cellWidth;
        this.viewF32[GlyphGridParamsLayout.offsets.cellSize / 4 + 1] =
            params.cellHeight;

        this.viewF32[GlyphGridParamsLayout.offsets.atlasTexelSize / 4] =
            1.0 / params.atlasWidth;
        this.viewF32[GlyphGridParamsLayout.offsets.atlasTexelSize / 4 + 1] =
            1.0 / params.atlasHeight;

        this.viewU32[GlyphGridParamsLayout.offsets.glyphCount / 4] =
            params.glyphCount;

        this.viewU32[GlyphGridParamsLayout.offsets.cols / 4] =
            params.cols;
        this.viewU32[GlyphGridParamsLayout.offsets.rows / 4] =
            params.rows;

        this.viewU32[GlyphGridParamsLayout.offsets.maxTrail / 4] =
            params.maxTrail;
    }

    /**
     * Upload current staging contents to GPU.
     * Caller controls when GPU queue write is issued.
     */
    flush(): void {
        this.device.queue.writeBuffer(this.buffer, 0, this.staging);
    }

    update(params: GlyphGridParams): void {
        this.set(params);
        this.flush();
    }
}
