export type PresentParams = {
    vignetteStrength: number;
    scanlineStrength: number;
    noiseAmplitude: number;
    curvature: number;
    tint: [number, number, number];
    scanlineFreq: number;
    bloomIntensity: number;
    flickerAmplitude: number;
    flickerFrequency: number;
};

function mkLabel(text: string): HTMLLabelElement {
    const l = document.createElement('label');
    l.style.display = 'flex';
    l.style.justifyContent = 'space-between';
    l.style.alignItems = 'center';
    l.style.fontFamily = 'monospace';
    l.style.fontSize = '12px';
    l.style.color = '#bfe3b4';
    l.style.margin = '6px 0';
    l.textContent = text;
    return l;
}

function mkSlider(min: number, max: number, step: number, value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.width = '160px';
    return input;
}

export function createDebugUI(
    initial: PresentParams,
    onPresentChange: (p: Partial<PresentParams>) => void,
    onDecayChange: (v: number) => void,
) {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.right = '12px';
    container.style.top = '12px';
    container.style.background = 'rgba(4,20,4,0.65)';
    container.style.border = '1px solid rgba(100,200,100,0.2)';
    container.style.padding = '10px';
    container.style.borderRadius = '8px';
    container.style.zIndex = '9999';

    const title = document.createElement('div');
    title.textContent = 'Debug — Phosphor';
    title.style.color = '#c8f2c8';
    title.style.fontFamily = 'monospace';
    title.style.marginBottom = '6px';
    container.appendChild(title);

    // decay slider
    const decayLabel = mkLabel('decay');
    const decaySlider = mkSlider(0.6, 0.99, 0.01, 0.75);
    const decayVal = document.createElement('span');
    decayVal.textContent = decaySlider.value;
    decayLabel.appendChild(decaySlider);
    decayLabel.appendChild(decayVal);
    container.appendChild(decayLabel);
    decaySlider.addEventListener('input', () => {
        const v = parseFloat(decaySlider.value);
        decayVal.textContent = v.toFixed(2);
        onDecayChange(v);
    });

    // helper to create a slider + value for present params
    function makeParam(
        name: string,
        min: number,
        max: number,
        step: number,
        value: number,
        cb: (v: number) => void,
    ) {
        const label = mkLabel(name);
        const slider = mkSlider(min, max, step, value);
        const valueEl = document.createElement('span');
        valueEl.textContent = slider.value;
        label.appendChild(slider);
        label.appendChild(valueEl);
        container.appendChild(label);
        slider.addEventListener('input', () => {
            const nv = parseFloat(slider.value);
            valueEl.textContent = nv.toFixed(3);
            cb(nv);
        });
        return { slider, valueEl };
    }

    makeParam('vignette', 0, 1, 0.01, initial.vignetteStrength, (v) => onPresentChange({ vignetteStrength: v }));
    makeParam('scanline', 0, 1, 0.01, initial.scanlineStrength, (v) => onPresentChange({ scanlineStrength: v }));
    makeParam('noise', 0, 0.1, 0.001, initial.noiseAmplitude, (v) => onPresentChange({ noiseAmplitude: v }));
    makeParam('curvature', 0, 0.2, 0.001, initial.curvature, (v) => onPresentChange({ curvature: v }));
    makeParam('bloom', 0, 1, 0.01, initial.bloomIntensity, (v) => onPresentChange({ bloomIntensity: v }));

    makeParam(
        'flicker amp',
        0,
        0.5,
        0.001,
        initial.flickerAmplitude,
        (v) => onPresentChange({ flickerAmplitude: v })
    );
    makeParam(
        'flicker freq',
        0,
        4,
        0.01,
        initial.flickerFrequency,
        (v) => onPresentChange({ flickerFrequency: v })
    );

    // tint quick buttons
    const btnGreen = document.createElement('button');
    btnGreen.textContent = 'Green';
    btnGreen.onclick = () => onPresentChange({ tint: [0.0, 1.0, 0.0] });

    const btnWhite = document.createElement('button');
    btnWhite.textContent = 'White';
    btnWhite.onclick = () => onPresentChange({ tint: [1.0, 1.0, 1.0] });

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
