type TintTuple = [number, number, number];

export type ConfigParameters = {
    scale: number;
    // SimulationParams
    flickerAmplitude: number;
    flickerFrequency: number;
    // HistoryParams
    retention: number;
    // PresentParams
    vignetteStrength: number;
    scanlineFreq: number;
    scanlineStrength: number;
    noiseAmplitude: number;
    curvature: number;
    tint: TintTuple;
    bloomIntensity: number;
};

type Specs = {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly label: string;
};

const ConfigParameterSpecs: {
    [K in Exclude<keyof ConfigParameters, 'tint'>]: Specs;
} = {
    scale: { min: 0.5, max: 2.0, step: 0.25, label: 'Screen scale' },
    flickerAmplitude: { min: 0, max: 0.5, step: 0.001, label: 'Flicker amp' },
    flickerFrequency: { min: 0, max: 4, step: 0.01, label: 'Flicker freq' },
    retention: { min: 0, max: 0.99, step: 0.01, label: 'Retention' },
    vignetteStrength: { min: 0, max: 1, step: 0.01, label: 'Vignette' },
    scanlineFreq: { min: 200, max: 1500, step: 10.0, label: 'Scanline freq' },
    scanlineStrength: { min: 0, max: 1, step: 0.01, label: 'Scanline' },
    noiseAmplitude: { min: 0, max: 0.2, step: 0.01, label: 'Noise' },
    curvature: { min: 0, max: 0.2, step: 0.01, label: 'Curvature' },
    bloomIntensity: { min: 0, max: 1, step: 0.01, label: 'Bloom' },
};

type TintPreset = {
    readonly label: string;
    readonly values: TintTuple;
}

const TINT_PRESETS = [
    { label: 'Classic', values: [0.00, 1.00, 0.20] },
    { label: 'Neon',    values: [0.05, 1.00, 0.45] },
    { label: 'Zion',    values: [1.00, 0.55, 0.05] },
    { label: 'Modern',  values: [0.10, 0.85, 0.90] },
] as const satisfies readonly TintPreset[];

function makeLabel(text: string): HTMLLabelElement {
    const l = document.createElement('label');
    l.style.display = 'flex';
    l.style.justifyContent = 'flex-end';
    l.style.columnGap = '8px';
    l.style.alignItems = 'center';
    l.style.marginBottom = '4px';
    l.style.fontSize = '12px';
    l.textContent = text;
    return l;
}

type SliderHandle = {
    setValue(value: number): void;
};

function makeSlider(
    specs: Specs,
    value: number,
    onChange: (value: number) => void,
): { element: HTMLElement; handle: SliderHandle } {
    const label = makeLabel(specs.label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(specs.min);
    slider.max = String(specs.max);
    slider.step = String(specs.step);
    slider.value = String(value);
    slider.style.width = '160px';

    const valueEl = document.createElement('span');
    valueEl.style.textAlign = 'right';
    valueEl.style.width = '40px';
    valueEl.textContent = value.toFixed(2);

    slider.addEventListener('input', () => {
        const newValue = parseFloat(slider.value);
        valueEl.textContent = newValue.toFixed(2);
        onChange(newValue);
    });

    label.appendChild(slider);
    label.appendChild(valueEl);

    return {
        element: label,
        handle: {
            setValue(newValue: number): void {
                slider.value = String(newValue);
                valueEl.textContent = newValue.toFixed(2);
            },
        },
    };
}

interface EffectsPanelHandle {
    destroy(): void;
}

export function createEffectsPanel(
    config: ConfigParameters,
    onParameterChange: (changedConfig: Partial<ConfigParameters>) => void,
): EffectsPanelHandle {
    // Immutable snapshot of initial values
    const initialConfig: ConfigParameters = {
        ...config,
        tint: [...config.tint],
    };

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.right = '10px';
    container.style.top = '10px';
    container.style.zIndex = '9999';
    container.style.background = 'rgba(22, 22, 22, 0.66)';
    container.style.color = '#c8f2c8';
    container.style.fontFamily = 'monospace';
    container.style.border = '1px solid rgba(100, 200, 100, 0.2)';
    container.style.borderRadius = '8px';
    container.style.padding = '8px';

    const title = document.createElement('div');
    title.textContent = 'Effects Panel';
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    title.style.textAlign = 'center';
    container.appendChild(title);

    const sliderHandles: Partial<
        Record<Exclude<keyof ConfigParameters, 'tint'>, SliderHandle>
    > = {};

    (Object.keys(ConfigParameterSpecs) as Array<
        Exclude<keyof ConfigParameters, 'tint'>
    >).forEach((key) => {
        const specs = ConfigParameterSpecs[key];
        const value = config[key];

        const { element, handle } = makeSlider(specs, value, (newValue) => {
            onParameterChange({ [key]: newValue });
        });

        sliderHandles[key] = handle;
        container.appendChild(element);
    });

    /* --- Quick buttons --- */

    const createButtonsContainer = (): HTMLDivElement => {
        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.gap = '4px';
        el.style.marginTop = '8px';
        return el;
    };

    const addButton = (
        container: HTMLDivElement,
        label: string,
        onClick: () => void,
    ): void => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.onclick = onClick;
        container.appendChild(button);
    };

    // Tint Presets
    const tintPresetContainer = createButtonsContainer();

    TINT_PRESETS.forEach(({ label, values }) => {
        addButton(
            tintPresetContainer,
            label,
            () => onParameterChange({ tint: values })
        );
    });

    const setupContainer = createButtonsContainer();

    // Min values button
    addButton(
        setupContainer,
        'Set Min',
        () => {
            const minValues: Partial<ConfigParameters> = {};

            (Object.keys(ConfigParameterSpecs) as Array<
                Exclude<keyof ConfigParameters, 'tint'>
            >).forEach((key) => {
                const specs = ConfigParameterSpecs[key];
                minValues[key] = specs.min;
            });

            onParameterChange(minValues);

            // sync UI sliders
            (Object.keys(sliderHandles) as Array<
                Exclude<keyof ConfigParameters, 'tint'>
            >).forEach((key) => {
                const handle = sliderHandles[key];
                if (handle !== undefined) {
                    handle.setValue(ConfigParameterSpecs[key].min);
                }
            });
        }
    );

    // Reset button
    addButton(
        setupContainer,
        'Reset',
        () => {
            onParameterChange(initialConfig);

            (Object.keys(sliderHandles) as Array<
                Exclude<keyof ConfigParameters, 'tint'>
            >).forEach((key) => {
                sliderHandles[key]?.setValue(initialConfig[key]);
            });
        }
    );

    container.appendChild(tintPresetContainer);
    container.appendChild(setupContainer);

    document.body.appendChild(container);

    return {
        destroy(): void {
            container.remove();
        },
    };
}

export function initEffectsPanel(
    config: ConfigParameters,
    onParameterChange: (changedConfig: Partial<ConfigParameters>) => void,
): void {
    let effectsPanel: EffectsPanelHandle | null = null;

    console.info("Press 'c' to toggle Effects Panel");

    /**
     * Determines whether a keyboard event originated from a text-input context.
     */
    function isFromEditableElement(event: KeyboardEvent): boolean {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        const tagName = target.tagName;
        return (
            tagName === 'INPUT' ||
            tagName === 'TEXTAREA' ||
            target.isContentEditable
        );
    }

    window.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key.toLowerCase() !== 'c') {
            return;
        }

        if (isFromEditableElement(event)) {
            return;
        }

        if (effectsPanel === null) {
            effectsPanel = createEffectsPanel(config, onParameterChange);
        } else {
            effectsPanel.destroy();
            effectsPanel = null;
        }
    });
}
