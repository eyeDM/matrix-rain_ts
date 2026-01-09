export type RenderTargetDescriptor = {
    size: 'screen';
    format: GPUTextureFormat;
    usage: GPUTextureUsageFlags;
    sampleCount?: number;
};

type InternalTarget = {
    texture: GPUTexture;
    view: GPUTextureView;
    desc: RenderTargetDescriptor;
};

export interface RenderTargetRegistry {
    getColor(name: string, desc: RenderTargetDescriptor): GPUTextureView;
    getDepth(name: string, format?: GPUTextureFormat): GPUTextureView;
    resize(width: number, height: number): void;
    destroy(): void;
}

export function createRenderTargetRegistry(
    device: GPUDevice,
    initialWidth: number,
    initialHeight: number,
): RenderTargetRegistry {
    let width = initialWidth;
    let height = initialHeight;

    const colorTargets = new Map<string, InternalTarget>();
    const depthTargets = new Map<string, GPUTexture>();

    function createColorTarget(
        desc: RenderTargetDescriptor,
    ): InternalTarget {
        const texture = device.createTexture({
            label: 'RenderTarget:Color',
            size: { width, height },
            format: desc.format,
            usage: desc.usage,
            sampleCount: desc.sampleCount ?? 1,
        });

        return {
            texture,
            view: texture.createView(),
            desc,
        };
    }

    return {
        getColor(name, desc): GPUTextureView {
            const existing = colorTargets.get(name);
            if (existing) return existing.view;

            const target = createColorTarget(desc);
            colorTargets.set(name, target);
            return target.view;
        },

        getDepth(
            name,
            format: GPUTextureFormat = 'depth24plus',
        ): GPUTextureView {
            const existing = depthTargets.get(name);
            if (existing) return existing.createView();

            const texture = device.createTexture({
                label: 'RenderTarget:Depth',
                size: { width, height },
                format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });

            depthTargets.set(name, texture);
            return texture.createView();
        },

        resize(newWidth, newHeight): void {
            if (newWidth === width && newHeight === height) return;

            width = newWidth;
            height = newHeight;

            for (const target of colorTargets.values()) {
                target.texture.destroy();
            }
            colorTargets.clear();

            for (const tex of depthTargets.values()) {
                tex.destroy();
            }
            depthTargets.clear();
        },

        destroy(): void {
            for (const target of colorTargets.values()) {
                target.texture.destroy();
            }
            for (const tex of depthTargets.values()) {
                tex.destroy();
            }
            colorTargets.clear();
            depthTargets.clear();
        },
    };
}
