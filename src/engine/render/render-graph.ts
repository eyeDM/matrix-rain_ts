export type PassKind = 'compute' | 'draw' | 'post';

/**
 * Single frame execution context.
 * GPUTextureView is retrieved lazily.
 */
export type RenderContext = {
    readonly encoder: GPUCommandEncoder;
    readonly dt: number;
    /**
     * Current output view (usually it's swapchain).
     */
    acquireView(): GPUTextureView | null;
};

export type RenderPass = {
    name: string;
    kind: PassKind;
    deps?: readonly string[]; // names of passes this pass depends on
    execute(ctx: RenderContext): void;
};

export type RenderGraph = {
    addPass: (pass: RenderPass) => void;
    removePass: (name: string) => void;
    execute(ctx: RenderContext): void;
};

function topoSort(passes: Map<string, RenderPass>): RenderPass[] {
    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const [name] of passes) {
        inDegree.set(name, 0);
        adj.set(name, []);
    }

    for (const [name, pass] of passes) {
        for (const dep of pass.deps ?? []) {
            if (!passes.has(dep)) {
                throw new Error(
                    `RenderGraph: pass '${name}' depends on unknown pass '${dep}'`,
                );
            }

            inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
            adj.get(dep)!.push(name);
        }
    }

    const queue: string[] = [];
    for (const [k, v] of inDegree) {
        if (v === 0) queue.push(k);
    }

    const ordered: RenderPass[] = [];
    while (queue.length > 0) {
        const n = queue.shift()!;
        ordered.push(passes.get(n)!);
        for (const m of adj.get(n)!) {
            const d = (inDegree.get(m) ?? 0) - 1;
            inDegree.set(m, d);
            if (d === 0) queue.push(m);
        }
    }

    if (ordered.length !== passes.size) {
        throw new Error('RenderGraph: cyclic or missing dependencies detected');
    }

    return ordered;
}

export function createRenderGraph(): RenderGraph {
    const passes = new Map<string, RenderPass>();

    return {
        addPass(pass: RenderPass) {
            if (passes.has(pass.name)) {
                throw new Error(
                    `RenderGraph: pass '${pass.name}' already exists`,
                );
            }
            passes.set(pass.name, pass);
        },

        removePass(name: string) {
            passes.delete(name);
        },

        execute(ctx: RenderContext) {
            const ordered = topoSort(passes);

            for (const pass of ordered) {
                try {
                    pass.execute(ctx);
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error(`RenderGraph: error executing pass '${pass.name}':`, e);
                }
            }
        }
    };
}
