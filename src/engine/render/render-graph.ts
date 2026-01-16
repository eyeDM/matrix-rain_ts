import { ResourceManager } from "@platform/webgpu/resource-manager";

export type RGResourceName = string;

export type RGPassType =
    | 'compute'
    | 'draw'
    | 'post'
    | 'present';

export interface RGPass {
    readonly name: string;
    readonly type: RGPassType;

    readonly reads: readonly RGResourceName[];
    readonly writes: readonly RGResourceName[];

    execute(ctx: RenderContext): void;
}

/**
 * Single frame execution context.
 * GPUTextureView is retrieved lazily.
 */
export type RenderContext = {
    readonly device: GPUDevice;
    readonly encoder: GPUCommandEncoder;
    readonly resources: ResourceManager;
    readonly dt: number;
    acquireView(): GPUTextureView | null; // Current output view (usually it's swapchain)
};

export class RenderGraphBuilder {
    private readonly passes: RGPass[] = [];

    addPass(pass: RGPass): void {
        this.assertUniqueName(pass.name);
        this.passes.push(pass);
    }

    build(): RenderGraph {
        const ordered = this.topologicalSort(this.passes);
        return new RenderGraph(ordered);
    }

    // --- Internal ---

    private assertUniqueName(name: string): void {
        if (this.passes.some(p => p.name === name)) {
            throw new Error(`RenderGraph: duplicate pass name '${name}'`);
        }
    }

    private topologicalSort(passes: RGPass[]): RGPass[] {
        const result: RGPass[] = [];
        const remaining = new Set(passes);
        const executed = new Set<RGPass>();

        const lastWriter = new Map<RGResourceName, RGPass>();

        while (remaining.size > 0) {
            let progress = false;

            for (const pass of Array.from(remaining)) {
                if (this.canExecute(pass, lastWriter, executed)) {
                    remaining.delete(pass);
                    executed.add(pass);
                    result.push(pass);

                    for (const r of pass.writes) {
                        lastWriter.set(r, pass);
                    }

                    progress = true;
                }
            }

            if (!progress) {
                throw new Error(
                    'RenderGraph: cyclic or unsatisfiable resource dependencies'
                );
            }
        }

        return result;
    }

    private canExecute(
        pass: RGPass,
        lastWriter: Map<RGResourceName, RGPass>,
        executed: Set<RGPass>,
    ): boolean {
        for (const r of pass.reads) {
            const writer = lastWriter.get(r);
            if (writer !== undefined && !executed.has(writer)) {
                return false;
            }
        }
        return true;
    }
}

export class RenderGraph {
    constructor(
        private readonly passes: readonly RGPass[]
    ) {}

    execute(ctx: RenderContext): void {
        //const encoder = ctx.device.createCommandEncoder();

        for (const pass of this.passes) {
            pass.execute(ctx);
        }

        //ctx.device.queue.submit([encoder.finish()]);
    }
}
