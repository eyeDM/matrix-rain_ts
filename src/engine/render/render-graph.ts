export type PassKind = 'compute' | 'draw' | 'post';

export type RenderPass = {
    name: string;
    kind: PassKind;
    deps?: string[]; // names of passes this pass depends on
    // Optional list of resource keys this pass owns (informational)
    resources?: string[];
    execute: (encoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) => void;
};

export type RenderGraph = {
    addPass: (pass: RenderPass) => void;
    removePass: (name: string) => void;
    execute: (encoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) => void;
};

function topoSort(passes: Map<string, RenderPass>): RenderPass[] {
    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const [name, pass] of passes) {
        inDegree.set(name, 0);
        adj.set(name, []);
    }

    for (const [name, pass] of passes) {
        const deps = pass.deps ?? [];
        for (const d of deps) {
            if (!passes.has(d)) throw new Error(`RenderGraph: pass '${name}' depends on unknown pass '${d}'`);
            inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
            const list = adj.get(d)!;
            list.push(name);
        }
    }

    const queue: string[] = [];
    for (const [k, v] of inDegree) if (v === 0) queue.push(k);

    const out: RenderPass[] = [];
    while (queue.length) {
        const n = queue.shift()!;
        out.push(passes.get(n)!);
        const neighbors = adj.get(n)!;
        for (const m of neighbors) {
            inDegree.set(m, (inDegree.get(m) ?? 0) - 1);
            if (inDegree.get(m) === 0) queue.push(m);
        }
    }

    if (out.length !== passes.size) {
        throw new Error('RenderGraph: cyclic or missing dependencies detected');
    }

    return out;
}

export function createRenderGraph(): RenderGraph {
    const passes = new Map<string, RenderPass>();

    return {
        addPass(pass: RenderPass) {
            if (passes.has(pass.name)) throw new Error(`RenderGraph: pass with name '${pass.name}' already exists`);
            passes.set(pass.name, pass);
        },
        removePass(name: string) {
            passes.delete(name);
        },
        execute(encoder: GPUCommandEncoder, currentView: GPUTextureView, dt: number) {
            const ordered = topoSort(passes);
            for (const p of ordered) {
                try {
                    p.execute(encoder, currentView, dt);
                } catch (e) {
                    // Keep render loop resilient: log and continue executing remaining passes
                    // eslint-disable-next-line no-console
                    console.error(`RenderGraph: error executing pass '${p.name}':`, e);
                }
            }
        }
    };
}
