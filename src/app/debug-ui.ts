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

type Specs = { min: number, max: number, step: number };

const ConfigParameterSpecs = {
    flickerAmplitude: { min: 0, max: 0.5, step: 0.001 },
    flickerFrequency: { min: 0, max: 4, step: 0.01 },
    decay: { min: 0.6, max: 0.99, step: 0.01 },
    vignetteStrength: { min: 0, max: 1, step: 0.01 },
    scanlineStrength: { min: 0, max: 1, step: 0.01 },
    noiseAmplitude: { min: 0, max: 1, step: 0.01 },
    curvature: { min: 0, max: 0.2, step: 0.01 },
    bloomIntensity: { min: 0, max: 1, step: 0.01 },
    //_tpl: { min: 0, max: 0, step: 0 },
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

function makeSlider(min: number, max: number, step: number, value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.width = '160px';
    return input;
}

export function createEffectsPanel(
    config: ConfigParameters,
    onParameterChange: (changedConfig: Partial<ConfigParameters>) => void,
) {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.right = '10px';
    container.style.top = '10px';
    //container.style.width = '300px';
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

    // helper to create a slider + value for present params
    function makeControl(
        label: string,
        specs: Specs,
        value: number,
        onChange: (newValue: number) => void,
    ) {
        const labelEl = makeLabel(label);
        const slider = makeSlider(specs.min, specs.max, specs.step, value);
        const valueEl = document.createElement('span');
        valueEl.textContent = parseFloat(slider.value).toFixed(2);
        labelEl.appendChild(slider);
        labelEl.appendChild(valueEl);
        container.appendChild(labelEl);
        slider.addEventListener('input', () => {
            const newValue = parseFloat(slider.value);
            valueEl.textContent = newValue.toFixed(2);
            onChange(newValue);
        });
        return { slider, valueEl };
    }

    makeControl(
        'Flicker amp',
        ConfigParameterSpecs.flickerAmplitude,
        config.flickerAmplitude,
        (value) => onParameterChange({flickerAmplitude: value}),
    );
    makeControl(
        'Flicker freq',
        ConfigParameterSpecs.flickerFrequency,
        config.flickerFrequency,
        (value) => onParameterChange({flickerFrequency: value}),
    );
    makeControl(
        'Decay',
        ConfigParameterSpecs.decay,
        config.decay,
        (value) => onParameterChange({decay: value}),
    );
    makeControl(
        'Vignette',
        ConfigParameterSpecs.vignetteStrength,
        config.vignetteStrength,
        (value) => onParameterChange({vignetteStrength: value}),
    );
    makeControl(
        'Scanline',
        ConfigParameterSpecs.scanlineStrength,
        config.scanlineStrength,
        (value) => onParameterChange({scanlineStrength: value}),
    );
    makeControl(
        'Noise',
        ConfigParameterSpecs.noiseAmplitude,
        config.noiseAmplitude,
        (value) => onParameterChange({noiseAmplitude: value}),
    );
    makeControl(
        'Curvature',
        ConfigParameterSpecs.curvature,
        config.curvature,
        (value) => onParameterChange({curvature: value}),
    );
    makeControl(
        'Bloom',
        ConfigParameterSpecs.bloomIntensity,
        config.bloomIntensity,
        (value) => onParameterChange({bloomIntensity: value}),
    );
    /*makeControl(
        '_Label',
        ConfigParameterSpecs._tpl,
        config._tpl,
        (value) => onParameterChange({_tpl: value}),
    );*/

    // tint quick buttons
    const btnGreen = document.createElement('button');
    btnGreen.textContent = 'Green';
    btnGreen.onclick = () => onParameterChange({tint: [0.0, 1.0, 0.0]});

    const btnWhite = document.createElement('button');
    btnWhite.textContent = 'White';
    btnWhite.onclick = () => onParameterChange({tint: [1.0, 1.0, 1.0]});

    const tintRow = document.createElement('div');
    tintRow.style.display = 'flex';
    tintRow.style.gap = '6px';
    tintRow.style.marginTop = '8px';
    tintRow.appendChild(btnGreen);
    tintRow.appendChild(btnWhite);
    container.appendChild(tintRow);

    document.body.appendChild(container);

    return {
        destroy() { container.remove(); }
    };
}
