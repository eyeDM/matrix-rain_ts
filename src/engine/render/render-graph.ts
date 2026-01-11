import { RenderTargetRegistry } from '@engine/render/render-target-registry';

export type RGBufferHandle = { readonly kind: 'buffer'; readonly name: string };
export type RGTextureHandle = { readonly kind: 'texture'; readonly name: string };

export type RGResourceHandle = RGBufferHandle | RGTextureHandle;

export type RGTextureDescriptor = {
    readonly format: GPUTextureFormat;
    readonly usage: GPUTextureUsageFlags;
    readonly size: 'screen' | { width: number; height: number };
};

type RGBufferDescriptor = {
    readonly size: number;
    readonly usage: GPUBufferUsageFlags;
};

type RGResourceDescriptor =
    | { kind: 'texture'; desc: RGTextureDescriptor }
    | { kind: 'buffer';  desc: RGBufferDescriptor };

/**
 * Single frame execution context.
 * GPUTextureView is retrieved lazily.
 */
export type RenderContext = {
    readonly encoder: GPUCommandEncoder;
    readonly dt: number;
    resources: RenderTargetRegistry;
    acquireView(): GPUTextureView | null; // Current output view (usually it's swapchain)
};

export type RenderNodeKind =
    | 'compute'
    | 'draw'
    | 'post'
    | 'present';

export type RenderNode = {
    readonly name: string;
    readonly kind: RenderNodeKind;
    execute(ctx: RenderContext): void;
    destroy?(): void; // Destroy internally created GPU resources
};

export type RenderPassNode = {
    readonly name: string;
    readonly reads?: readonly RGResourceHandle[];
    readonly writes?: readonly RGResourceHandle[];
    execute(ctx: RenderContext): void;
};

export type CompiledRenderGraph = {
    execute(ctx: RenderContext): void;
};

function compileRenderGraph(
    passes: readonly RenderPassNode[],
): CompiledRenderGraph {
    // Build adjacency list
    const edges = new Map<RenderPassNode, Set<RenderPassNode>>();
    const inDegree = new Map<RenderPassNode, number>();

    for (const p of passes) {
        edges.set(p, new Set());
        inDegree.set(p, 0);
    }

    // Resource-based dependency resolution
    for (const a of passes) {
        for (const b of passes) {
            if (a === b) continue;

            const aWrites = a.writes ?? [];
            const bReads = b.reads ?? [];
            const bWrites = b.writes ?? [];

            const hazard =
                aWrites.some(r => bReads.includes(r)) ||
                aWrites.some(r => bWrites.includes(r));

            if (hazard) {
                edges.get(a)!.add(b);
                inDegree.set(b, inDegree.get(b)! + 1);
            }
        }
    }

    // Kahn's algorithm
    const queue: RenderPassNode[] = [];
    for (const [p, deg] of inDegree) {
        if (deg === 0) queue.push(p);
    }

    const ordered: RenderPassNode[] = [];
    while (queue.length > 0) {
        const p = queue.shift()!;
        ordered.push(p);
        for (const n of edges.get(p)!) {
            const d = inDegree.get(n)! - 1;
            inDegree.set(n, d);
            if (d === 0) queue.push(n);
        }
    }

    if (ordered.length !== passes.length) {
        throw new Error('RG: cyclic dependency detected');
    }

    return {
        execute(ctx) {
            for (const pass of ordered) {
                pass.execute(ctx);
            }
        },
    };
}

export class RenderGraphBuilder {
    private readonly resources = new Map<string, RGResourceDescriptor>();
    private readonly passes: RenderPassNode[] = [];

    createBuffer(
        name: string,
        desc: RGBufferDescriptor,
    ): RGBufferHandle {
        this.assertResourceFree(name);
        this.resources.set(name, {
            kind: 'buffer',
            desc,
        });
        return { kind: 'buffer', name };
    }

    createTexture(
        name: string,
        desc: RGTextureDescriptor,
    ): RGTextureHandle {
        this.assertResourceFree(name);
        this.resources.set(name, {
            kind: 'texture',
            desc,
        });
        return { kind: 'texture', name };
    }

    addPass(pass: RenderPassNode): void {
        this.passes.push(pass);
    }

    compile(): CompiledRenderGraph {
        return compileRenderGraph(this.passes);
    }

    /**
     * Returns all texture descriptors declared in the render graph.
     * Used by RenderTargetRegistry as the authoritative texture list.
     */
    getTextureDescriptors(): Map<string, RGTextureDescriptor> {
        const textures = new Map<string, RGTextureDescriptor>();

        for (const [name, res] of this.resources) {
            if (res.kind === 'texture') {
                textures.set(name, res.desc);
            }
        }

        return textures;
    }

    private assertResourceFree(name: string): void {
        if (this.resources.has(name)) {
            throw new Error(
                `RenderGraphBuilder: resource '${name}' already exists`,
            );
        }
    }
}
