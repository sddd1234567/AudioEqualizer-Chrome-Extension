
document.addEventListener('DOMContentLoaded', () => {
    const FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const GAIN_LIMIT = 15; // dB

    const eqContainer = document.getElementById('eq-container');
    const powerSwitch = document.getElementById('power-switch');
    const presetsSelect = document.getElementById('presets-select');
    const savePresetBtn = document.getElementById('save-preset-btn');
    const deletePresetBtn = document.getElementById('delete-preset-btn');
    const resetEqBtn = document.getElementById('reset-eq-btn');
    const presetNameInput = document.getElementById('preset-name-input');

    let state = {
        gains: FREQUENCIES.reduce((acc, freq) => ({ ...acc, [freq]: 0 }), {}),
        enabled: true,
        presets: {},
    };

    function createEQBands() {
        eqContainer.innerHTML = '';
        FREQUENCIES.forEach(freq => {
            const band = document.createElement('div');
            band.className = 'band';

            const sliderWrapper = document.createElement('div');
            sliderWrapper.className = 'slider-wrapper';

            const gainValueEl = document.createElement('div');
            gainValueEl.className = 'gain-value';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = -GAIN_LIMIT;
            slider.max = GAIN_LIMIT;
            slider.step = 0.1;
            slider.value = 0;
            slider.dataset.freq = freq;
            slider.setAttribute('orient', 'vertical');

            const freqLabel = document.createElement('div');
            freqLabel.className = 'freq-label';
            freqLabel.textContent = freq < 1000 ? `${freq}` : `${freq / 1000}k`;

            sliderWrapper.appendChild(gainValueEl);
            sliderWrapper.appendChild(slider);
            band.appendChild(freqLabel);
            band.appendChild(sliderWrapper);
            eqContainer.appendChild(band);

            slider.addEventListener('input', (e) => handleSliderChange(e.target));
            slider.addEventListener('dblclick', (e) => resetSlider(e.target));
        });
    }

    function handleSliderChange(slider) {
        const freq = slider.dataset.freq;
        const value = parseFloat(slider.value);
        state.gains[freq] = value;
        updateGainLabel(slider, value);
        applySettings();
    }

    function resetSlider(slider) {
        slider.value = 0;
        handleSliderChange(slider);
    }

    function updateGainLabel(slider, value) {
        const band = slider.closest('.band');
        const gainValueDiv = band.querySelector('.gain-value');
        if (gainValueDiv) {
            gainValueDiv.textContent = `${value.toFixed(1)}dB`;
        }
    }

    function updateUIFromState() {
        powerSwitch.checked = state.enabled;
        eqContainer.classList.toggle('disabled', !state.enabled);

        document.querySelectorAll('input[type="range"][orient="vertical"]').forEach(slider => {
            const freq = slider.dataset.freq;
            const value = state.gains[freq] || 0;
            slider.value = value;
            updateGainLabel(slider, value);
        });

        populatePresetsDropdown();
    }

    async function loadStateFromStorage() {
        try {
            const result = await chrome.storage.local.get(['audioWaveEQSettings', 'audioWaveEQPresets']);
            const settings = result.audioWaveEQSettings;
            const presets = result.audioWaveEQPresets;

            if (settings) {
                state.gains = settings.gains || state.gains;
                state.enabled = typeof settings.enabled === 'boolean' ? settings.enabled : true;
            }
            if (presets) {
                state.presets = presets;
            }

            updateUIFromState();
            applySettings(); // Apply on startup
        } catch (e) {
            console.error("Error loading state from storage:", e);
        }
    }

    function applySettings() {
        const { gains, enabled } = state;
        chrome.storage.local.set({ audioWaveEQSettings: { gains, enabled } });
        chrome.runtime.sendMessage({ type: 'APPLY_SETTINGS', gains, enabled });
    }

    function populatePresetsDropdown() {
        const selectedValue = presetsSelect.value;
        presetsSelect.innerHTML = '<option value="default">Default Preset</option>';
        Object.keys(state.presets).sort().forEach(name => {
            const option = new Option(name, name);
            presetsSelect.add(option);
        });
        presetsSelect.value = selectedValue && state.presets[selectedValue] ? selectedValue : 'default';
    }

    async function savePreset() {
        const name = presetNameInput.value.trim();
        if (!name || name === 'default') {
            alert('Please enter a valid preset name.');
            return;
        }

        state.presets[name] = { ...state.gains };
        await chrome.storage.local.set({ audioWaveEQPresets: state.presets });
        populatePresetsDropdown();
        presetsSelect.value = name;
        presetNameInput.value = '';
    }

    async function deletePreset() {
        const name = presetsSelect.value;
        if (name === 'default') {
            alert('Cannot delete the Default preset.');
            return;
        }

        if (confirm(`Are you sure you want to delete the preset "${name}"?`)) {
            delete state.presets[name];
            await chrome.storage.local.set({ audioWaveEQPresets: state.presets });
            presetsSelect.value = 'default';
            applySelectedPreset();
        }
    }

    function applySelectedPreset() {
        const name = presetsSelect.value;
        if (name === 'default') {
            resetEQ();
        } else {
            if (state.presets[name]) {
                state.gains = { ...state.presets[name] };
                presetNameInput.value = name;
                updateUIFromState();
                applySettings();
            }
        }
    }

    function resetEQ() {
        state.gains = FREQUENCIES.reduce((acc, freq) => ({ ...acc, [freq]: 0 }), {});
        presetNameInput.value = '';
        presetsSelect.value = 'default';
        updateUIFromState();
        applySettings();
    }

    powerSwitch.addEventListener('change', (e) => {
        state.enabled = e.target.checked;
        eqContainer.classList.toggle('disabled', !state.enabled);
        applySettings();
    });

    presetsSelect.addEventListener('change', applySelectedPreset);
    savePresetBtn.addEventListener('click', savePreset);
    deletePresetBtn.addEventListener('click', deletePreset);
    resetEqBtn.addEventListener('click', resetEQ);

    // --- Init ---
    createEQBands();
    loadStateFromStorage();
});
