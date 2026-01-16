import { RGPassType, RGPass, RenderContext } from '@engine/render/render-graph';
import { StreamBuffers, createStreamBuffers } from "@engine/simulation/streams";

const WORKGROUP_SIZE_X = 64; // must match WGSL @workgroup_size

export class SimulationPassBuilder {
    private readonly bindGroupLayout: GPUBindGroupLayout;
    private readonly renderPipeline: GPUComputePipeline;

    private streamBuffers: StreamBuffers | undefined;

    private isBuilt: boolean = false;

    constructor(
        private readonly device: GPUDevice,
        shader: GPUShaderModule,
        private readonly glyphUVsBuffer: GPUBuffer,
        private readonly glyphCount: number,
        private readonly cellWidth: number,
        private readonly cellHeight: number,
        private readonly instanceBufferName: string,
    ) {
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'Simulation BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },  // SimulationUniforms
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Heads
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Speeds
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Lengths
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Seeds
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },  // Columns
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // Energy
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },  // GlyphUVs
                { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },  // InstanceData
            ],
        });

        const pipelineLayout = device.createPipelineLayout({
            label: 'Simulation Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout],
        });

        this.renderPipeline = device.createComputePipeline({
            label: 'Matrix Simulation Pipeline',
            layout: pipelineLayout,
            compute: {
                module: shader,
                entryPoint: 'main',
            },
        });
    }

    build(
        cols: number,
        rows: number,
        maxTrail: number,
    ): RGPass {
        this.streamBuffers = createStreamBuffers(
            this.device,
            cols,
            rows,
            this.glyphCount,
            this.cellWidth,
            this.cellHeight,
            maxTrail,
        );

        const execute= (ctx: RenderContext): void => {
            const bindGroup = this.device.createBindGroup({
                label: 'Simulation Bind Group',
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.streamBuffers!.simulationUniforms } },
                    { binding: 1, resource: { buffer: this.streamBuffers!.heads } },
                    { binding: 2, resource: { buffer: this.streamBuffers!.speeds } },
                    { binding: 3, resource: { buffer: this.streamBuffers!.lengths } },
                    { binding: 4, resource: { buffer: this.streamBuffers!.seeds } },
                    { binding: 5, resource: { buffer: this.streamBuffers!.columns } },
                    { binding: 6, resource: { buffer: this.streamBuffers!.energy } },
                    { binding: 7, resource: { buffer: this.glyphUVsBuffer } },
                    { binding: 8, resource: { buffer: ctx.resources.getBuffer(this.instanceBufferName) } },
                ],
            });

            this.streamBuffers!.simulationWriter.writeFrame(ctx.dt);
            this.streamBuffers!.simulationWriter.flush(
                this.device.queue,
                this.streamBuffers!.simulationUniforms
            );

            const pass = ctx.encoder.beginComputePass();
            pass.setPipeline(this.renderPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(
                Math.ceil(cols / WORKGROUP_SIZE_X),
            );
            pass.end();
        };

        this.isBuilt = true;

        return {
            name: 'SimulationPass',
            type: 'compute' as RGPassType,
            reads: [],
            writes: ['InstanceBuffer'],
            execute: execute,
        };
    }

    rebuild(
        cols: number,
        rows: number,
        maxTrail: number,
    ): RGPass {
        if (this.isBuilt) {
            this.destroyResources();
        }

        return this.build(cols, rows, maxTrail);
    }

    private destroyResources(): void {
        if (typeof this.streamBuffers !== 'undefined') {
            this.streamBuffers.destroy();
        }
    }
}
