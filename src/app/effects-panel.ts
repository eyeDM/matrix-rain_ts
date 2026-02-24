export type ConfigParameters = {
    // SimulationParams
    flickerAmplitude: number;
    flickerFrequency: number;
    // HistoryParams
    decay: number;
    // PresentParams
    vignetteStrength: number;
    scanlineFreq: number;
    scanlineStrength: number;
    noiseAmplitude: number;
    curvature: number;
    tint: [number, number, number];
    bloomIntensity: number;
};

type Specs = {
    min: number;
    max: number;
    step: number;
    label: string;
};

const ConfigParameterSpecs: {
    [K in Exclude<keyof ConfigParameters, 'tint'>]: Specs;
} = {
    flickerAmplitude: { min: 0, max: 0.5, step: 0.001, label: 'Flicker amp' },
    flickerFrequency: { min: 0, max: 4, step: 0.01, label: 'Flicker freq' },
    decay: { min: 0, max: 0.99, step: 0.01, label: 'Decay' },
    vignetteStrength: { min: 0, max: 1, step: 0.01, label: 'Vignette' },
    scanlineFreq: { min: 200, max: 1500, step: 10.0, label: 'Scanline freq' },
    scanlineStrength: { min: 0, max: 1, step: 0.01, label: 'Scanline' },
    noiseAmplitude: { min: 0, max: 0.2, step: 0.01, label: 'Noise' },
    curvature: { min: 0, max: 0.2, step: 0.01, label: 'Curvature' },
    bloomIntensity: { min: 0, max: 1, step: 0.01, label: 'Bloom' },
};

function makeLabel(text: string): HTMLLabelElement {
    const l = document.createElement('label');
    l.style.display = 'flex';
    l.style.justifyContent = 'flex-end';
    l.style.columnGap = '8px';
    l.style.alignItems = 'center';
    l.style.fontSize = '12px';
    l.style.color = '#bfe3b4';
    l.style.margin = '4px 0';
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
    container.style.background = 'rgba(22, 22, 22, 0.66)';
    container.style.border = '1px solid rgba(100, 200, 100, 0.2)';
    container.style.padding = '10px';
    container.style.borderRadius = '8px';
    container.style.fontFamily = 'monospace';
    container.style.zIndex = '9999';

    const title = document.createElement('div');
    title.textContent = 'Effects Panel';
    title.style.fontWeight = '600';
    title.style.color = '#c8f2c8';
    title.style.marginBottom = '6px';
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

    /* --- Preset buttons --- */

    const buttonsRow = document.createElement('div');
    buttonsRow.style.display = 'flex';
    buttonsRow.style.gap = '6px';
    buttonsRow.style.marginTop = '8px';

    const addButton = (
        label: string,
        onClick: () => void,
    ) => {
        const button = document.createElement('button');
        button.textContent = label;
        button.onclick = onClick;
        buttonsRow.appendChild(button);
    };

    // Tint quick buttons
    addButton(
        'Green',
        () => onParameterChange({ tint: [0.05, 1.5, 0.05] })
    );
    addButton(
        'Orange',
        () => onParameterChange({ tint: [1.5, 0.85, 0.05] })
    );
    addButton(
        'White',
        () => onParameterChange({ tint: [1.0, 1.0, 1.0] })
    );

    // Min values button
    addButton(
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

    container.appendChild(buttonsRow);

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

    console.info("Press 'C' to toggle Effects Panel");

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
