import { ColumnStateLayout } from '@backend/layouts';
import { rndU32Math, rndU32Crypto, mulberry32 } from '@backend/rng';
import { GpuResourceScope } from '@backend/resource-tracker';

const SPEED_MIN = 4.0;
const SPEED_VARIANCE = 16.0;

const CELL_ENERGY_MIN = 1.25; // per cell
const CELL_ENERGY_VARIANCE = 2.0;

const TRAIL_LENGTH_MIN = 4;
const TRAIL_LENGTH_VARIANCE = 20;

/*type ColumnState = {
    head: number;
    speed: number;
    energy: number;
    length: number;
    seed: number;
}*/

export class ColumnsState {
    readonly buffer: GPUBuffer;

    private readonly staging: ArrayBuffer;
    private readonly viewF32: Float32Array;
    private readonly viewU32: Uint32Array;

    constructor(
        device: GPUDevice,
        scope: GpuResourceScope,
        cols: number,
        rows: number,
        maxTrail: number,
    ) {
        const size = cols * ColumnStateLayout.SIZE;

        this.buffer = scope.trackDestroyable(
            device.createBuffer({
                label: 'ColumnState Storage Buffer',
                size: size,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            })
        );

        this.staging = new ArrayBuffer(size);
        this.viewF32 = new Float32Array(this.staging);
        this.viewU32 = new Uint32Array(this.staging);

        const cryptoAvailable = typeof crypto !== 'undefined'
            && typeof (crypto as any).getRandomValues === 'function';

        const rndU32 = cryptoAvailable ? rndU32Crypto : rndU32Math;

        for (let i = 0; i < cols; i++) {
            const seed = rndU32();
            const rng = mulberry32(seed);

            let length
                = TRAIL_LENGTH_MIN + Math.floor(TRAIL_LENGTH_VARIANCE * rng());
            length = Math.min(length, maxTrail);

            const head = (rows + length) * rng() - length;

            const speed = SPEED_MIN + SPEED_VARIANCE * rng();

            const energy
                = (CELL_ENERGY_MIN + CELL_ENERGY_VARIANCE * rng()) * length;

            const base = (i * ColumnStateLayout.SIZE) / 4;
            this.viewF32[base + ColumnStateLayout.offsets.head / 4] = head;
            this.viewF32[base + ColumnStateLayout.offsets.speed / 4] = speed;
            this.viewF32[base + ColumnStateLayout.offsets.energy / 4] = energy;
            this.viewU32[base + ColumnStateLayout.offsets.length / 4] = length;
            this.viewU32[base + ColumnStateLayout.offsets.seed / 4] = seed;
        }

        device.queue.writeBuffer(this.buffer, 0, this.staging);
    }
}
