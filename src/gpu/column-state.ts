import { ColumnStateLayout } from '@backend/layouts';
import { rndU32Math, rndU32Crypto, mulberry32 } from '@backend/rng';
import { GpuResourceScope } from '@backend/resource-tracker';

export const TRAIL_LENGTH_MIN = 4;
export const TRAIL_LENGTH_MAX = 24;

const SPEED_MIN = 4.0;
const SPEED_LIMIT = 20.0;

const CELL_ENERGY_MIN = 1.25; // per cell
const CELL_ENERGY_LIMIT = 3.75;

/*type ColumnState = {
    seed: number;
    head: number;
    length: number;
    speed: number;
    energy: number;
    flicker: number;
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
        minTrail: number,
        maxTrail: number,
    ) {
        if (minTrail < 1 || minTrail > maxTrail) {
            throw new RangeError(
                `Invalid trail length range: ${minTrail}..${maxTrail}`,
            );
        }

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

        const trailLengthCount = maxTrail - minTrail + 1;

        for (let i = 0; i < cols; i++) {
            const seed = rndU32();
            const rng = mulberry32(seed);

            const length = minTrail
                + Math.floor(trailLengthCount * rng());

            const head = (rows + length) * rng() - length;

            const speed = SPEED_MIN
                + (SPEED_LIMIT - SPEED_MIN) * rng();

            const energyPerCell = CELL_ENERGY_MIN
                + (CELL_ENERGY_LIMIT - CELL_ENERGY_MIN) * rng();

            const energy = energyPerCell * length;

            const flicker = 1;

            const base = (i * ColumnStateLayout.SIZE) / 4;
            this.viewU32[base + ColumnStateLayout.offsets.seed / 4] = seed;
            this.viewF32[base + ColumnStateLayout.offsets.head / 4] = head;
            this.viewU32[base + ColumnStateLayout.offsets.length / 4] = length;
            this.viewF32[base + ColumnStateLayout.offsets.speed / 4] = speed;
            this.viewF32[base + ColumnStateLayout.offsets.energy / 4] = energy;
            this.viewF32[base + ColumnStateLayout.offsets.flicker / 4] = flicker;
        }

        device.queue.writeBuffer(this.buffer, 0, this.staging);
    }
}
