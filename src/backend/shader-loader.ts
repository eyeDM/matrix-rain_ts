/**
 * Centralized WGSL shader loader, compiler, and cache.
 *
 * Responsibilities:
 * - Fetch WGSL source
 * - Compile GPUShaderModule
 * - Cache by semantic key
 * - Fail fast on compilation errors
 *
 * Non-responsibilities:
 * - Pipeline creation
 * - Render pass logic
 * - Renderer lifecycle
 */

export class ShaderLoader {
    private readonly device: GPUDevice;

    /** Compiled shader modules (final, reusable) */
    private readonly modules = new Map<string, GPUShaderModule>();

    /** In-flight load promises to guarantee idempotency */
    private readonly pending = new Map<string, Promise<GPUShaderModule>>();

    constructor(device: GPUDevice) {
        this.device = device;
    }

    /**
     * Load and compile a WGSL shader.
     * Safe to call multiple times with the same key.
     */
    async load(key: string, url: string): Promise<GPUShaderModule> {
        if (this.modules.has(key)) {
            return this.modules.get(key)!;
        }

        if (this.pending.has(key)) {
            return this.pending.get(key)!;
        }

        const promise = this.loadInternal(key, url);
        this.pending.set(key, promise);

        try {
            const module = await promise;
            this.modules.set(key, module);
            return module;
        } finally {
            this.pending.delete(key);
        }
    }

    /**
     * Retrieve a compiled shader module.
     * Throws if missing.
     */
    get(key: string): GPUShaderModule {
        const module = this.modules.get(key);
        if (!module) {
            throw new Error(`ShaderLibrary: shader "${key}" was not loaded`);
        }
        return module;
    }

    has(key: string): boolean {
        return this.modules.has(key);
    }

    /**
     * Explicit destruction hook.
     * Shader modules themselves do not require manual destroy,
     * but clearing references ensures GC and logical shutdown.
     */
    destroy(): void {
        this.modules.clear();
        this.pending.clear();
    }

    /**
     * @param key
     * @param url
     * @private
     */
    private async loadInternal(
        key: string,
        url: string
    ): Promise<GPUShaderModule> {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(
                `ShaderLibrary: failed to fetch "${key}" (${res.status})`
            );
        }

        const code = await res.text();
        if (!code.trim()) {
            throw new Error(`ShaderLibrary: shader "${key}" is empty`);
        }

        const module = this.device.createShaderModule({
            label: `ShaderModule::${key}`,
            code,
        });

        // Fail fast on WGSL compilation errors
        const info = await module.getCompilationInfo();
        if (info.messages.some(m => m.type === 'error')) {
            const errors = info.messages
                .filter(m => m.type === 'error')
                .map(m => `${m.lineNum}:${m.linePos} ${m.message}`)
                .join('\n');

            throw new Error(
                `WGSL compilation failed for "${key}":\n${errors}`
            );
        }

        return module;
    }
}
