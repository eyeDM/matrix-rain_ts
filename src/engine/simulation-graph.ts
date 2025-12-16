/**
 * GPU Simulation Graph
 *
 * Executes ordered compute passes with explicit dependencies.
 * Mirrors RenderGraph semantics but is restricted to compute-only passes.
 */

export type SimulationPass = {
    name: string;
    deps?: string[];
    execute: (encoder: GPUCommandEncoder) => void;
};

export type SimulationGraph = {
    addPass: (pass: SimulationPass) => void;
    removePass: (name: string) => void;
    execute: (encoder: GPUCommandEncoder) => void;
};

function topoSort(passes: Map<string, SimulationPass>): SimulationPass[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const [name] of passes) {
        inDegree.set(name, 0);
        adj.set(name, []);
    }

    for (const [name, pass] of passes) {
        for (const dep of pass.deps ?? []) {
            if (!passes.has(dep)) {
                throw new Error(`SimulationGraph: '${name}' depends on unknown pass '${dep}'`);
            }
            inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
            adj.get(dep)!.push(name);
        }
    }

    const queue: string[] = [];
    for (const [k, v] of inDegree) {
        if (v === 0) queue.push(k);
    }

    const ordered: SimulationPass[] = [];
    while (queue.length) {
        const n = queue.shift()!;
        ordered.push(passes.get(n)!);
        for (const m of adj.get(n)!) {
            inDegree.set(m, (inDegree.get(m) ?? 0) - 1);
            if (inDegree.get(m) === 0) queue.push(m);
        }
    }

    if (ordered.length !== passes.size) {
        throw new Error('SimulationGraph: cyclic dependency detected');
    }

    return ordered;
}

export function createSimulationGraph(): SimulationGraph {
    const passes = new Map<string, SimulationPass>();

    return {
        addPass(pass) {
            if (passes.has(pass.name)) {
                throw new Error(`SimulationGraph: pass '${pass.name}' already exists`);
            }
            passes.set(pass.name, pass);
        },
        removePass(name) {
            passes.delete(name);
        },
        execute(encoder) {
            const ordered = topoSort(passes);
            for (const p of ordered) {
                p.execute(encoder);
            }
        }
    };
}
