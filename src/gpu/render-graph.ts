/**
 * Single frame execution context.
 * GPUTextureView is retrieved lazily.
 */
export type RenderContext = {
    readonly device: GPUDevice;
    readonly encoder: GPUCommandEncoder;
    readonly dt: number;
    acquireView(): GPUTextureView | null; // Current output view (usually it's swapchain)
};

export interface ExecutablePass {
    execute(ctx: RenderContext): void;
}

export type GraphResource =
    | GPUBuffer
    | GPUTexture
    | GPUTextureView;

interface GraphNode {
    readonly pass: ExecutablePass;
    readonly reads: Set<GraphResource>;
    readonly writes: Set<GraphResource>;
}

export class PassBuilder {
    constructor(private readonly node: GraphNode) {}

    reads(...resources: readonly GraphResource[]): this {
        for (const r of resources) {
            this.node.reads.add(r);
        }
        return this;
    }

    writes(...resources: readonly GraphResource[]): this {
        for (const r of resources) {
            this.node.writes.add(r);
        }
        return this;
    }
}

export class RenderGraph {
    constructor(
        private readonly orderedPasses: readonly ExecutablePass[]
    ) {}

    //execute(device: GPUDevice): void {
    execute(ctx: RenderContext): void {
        //const encoder = device.createCommandEncoder();

        for (const pass of this.orderedPasses) {
            //pass.execute(encoder);
            pass.execute(ctx);
        }

        //device.queue.submit([encoder.finish()]);
    }
}

export class RenderGraphBuilder {
    private readonly nodes: GraphNode[] = [];

    addPass(pass: ExecutablePass): PassBuilder {
        const node: GraphNode = {
            pass,
            reads: new Set(),
            writes: new Set()
        };

        this.nodes.push(node);
        return new PassBuilder(node);
    }

    build(): RenderGraph {
        const ordered = this.topologicalSort();
        return new RenderGraph(ordered.map(n => n.pass));
    }

    private topologicalSort(): GraphNode[] {
        const result: GraphNode[] = [];
        const visited = new Set<GraphNode>();
        const visiting = new Set<GraphNode>();

        const dependsOn = (a: GraphNode, b: GraphNode): boolean => {
            // a зависит от b, если читает то, что b пишет
            for (const r of a.reads) {
                if (b.writes.has(r)) return true;
            }
            return false;
        };

        const visit = (node: GraphNode): void => {
            if (visited.has(node)) return;
            if (visiting.has(node)) {
                throw new Error("RenderGraph cycle detected");
            }

            visiting.add(node);

            for (const other of this.nodes) {
                if (other !== node && dependsOn(node, other)) {
                    visit(other);
                }
            }

            visiting.delete(node);
            visited.add(node);
            result.push(node);
        };

        for (const node of this.nodes) {
            visit(node);
        }

        return result;
    }
}
