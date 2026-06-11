import { getSliderState, getToggleState } from "./juce/index.js";
import { drawKnob } from "./knob.js";
import { fmt, fmtLabel } from "./format.js";

// 动态参数显示
const readout = document.getElementById('readout');
function showReadout(pid, norm) {
    readout.textContent = fmtLabel(pid) + ': ' + fmt(pid, norm);
}

// === 旋钮 ===
let activeKnob = null, knobStartY = 0, knobStartVal = 0;

document.querySelectorAll('.kc').forEach(c => {
    const pid = c.dataset.p;
    c._sz = c.classList.contains('big') ? 52 : 44;
    const state = getSliderState(pid);

    const refresh = () => {
        const n = state.getNormalisedValue();
        drawKnob(c, n);
    };
    state.valueChangedEvent.addListener(refresh);
    state.propertiesChangedEvent.addListener(refresh);
    refresh();

    c.addEventListener('mousedown', e => {
        activeKnob = { canvas: c, state, pid };
        knobStartY = e.clientY;
        knobStartVal = state.getNormalisedValue();
        state.sliderDragStarted();
        showReadout(pid, knobStartVal);
        e.preventDefault();
    });
    c.addEventListener('dblclick', () => {
        state.sliderDragStarted();
        state.setNormalisedValue(0.5);
        state.sliderDragEnded();
    });
});

document.addEventListener('mousemove', e => {
    if (activeKnob) {
        const sens = e.shiftKey ? 0.001 : 0.005;
        const nv = Math.max(0, Math.min(1, knobStartVal + (knobStartY - e.clientY) * sens));
        activeKnob.state.setNormalisedValue(nv);
        showReadout(activeKnob.pid, nv);
    }
    if (activeFader) {
        const h = activeFader.track.clientHeight;
        const dy = faderStartY - e.clientY;
        const nv = Math.max(0, Math.min(1, faderStartVal + dy / h));
        activeFader.state.setNormalisedValue(nv);
        activeFader.thumb.style.bottom = (nv * (h - 8)) + 'px';
        showReadout(activeFader.pid, nv);
    }
    if (activeNumBtn) {
        const sens = 0.003;
        const nv = Math.max(0, Math.min(1, numBtnStartVal + (numBtnStartY - e.clientY) * sens));
        activeNumBtn.state.setNormalisedValue(nv);
        showReadout(activeNumBtn.pid, nv);
    }
    if (activeSeed) {
        const sens = 0.002;
        const nv = Math.max(0, Math.min(1, seedStartVal + (seedStartY - e.clientY) * sens));
        activeSeed.state.setNormalisedValue(nv);
        showReadout(activeSeed.pid, nv);
    }
});

document.addEventListener('mouseup', () => {
    if (activeKnob) { activeKnob.state.sliderDragEnded(); activeKnob = null; }
    if (activeFader) { activeFader.state.sliderDragEnded(); activeFader = null; }
    if (activeNumBtn) { activeNumBtn.state.sliderDragEnded(); activeNumBtn = null; }
    if (activeSeed) { activeSeed.state.sliderDragEnded(); activeSeed = null; }
});

// === Toggle 按钮 ===
document.querySelectorAll('.tbtn[data-t="toggle"]').forEach(btn => {
    const pid = btn.dataset.p;
    const state = getToggleState(pid);

    const refresh = () => {
        const on = state.getValue();
        btn.classList.toggle('on', on);
        btn.classList.toggle('off', !on);
        if (pid === 'late_mode') btn.textContent = on ? 'POST' : 'PRE';
        else btn.textContent = on ? 'ON' : 'OFF';
    };
    state.valueChangedEvent.addListener(refresh);
    refresh();

    btn.addEventListener('click', () => {
        state.setValue(!state.getValue());
    });
});

// === 数值按钮（按住拖动） ===
let activeNumBtn = null, numBtnStartY = 0, numBtnStartVal = 0;

document.querySelectorAll('.tbtn[data-t="num"]').forEach(btn => {
    const pid = btn.dataset.p;
    const state = getSliderState(pid);

    const refresh = () => {
        const n = state.getNormalisedValue();
        btn.textContent = fmt(pid, n);
    };
    state.valueChangedEvent.addListener(refresh);
    state.propertiesChangedEvent.addListener(refresh);
    refresh();

    btn.addEventListener('mousedown', e => {
        activeNumBtn = { btn, state, pid };
        numBtnStartY = e.clientY;
        numBtnStartVal = state.getNormalisedValue();
        state.sliderDragStarted();
        showReadout(pid, numBtnStartVal);
        e.preventDefault();
    });
});

// === 推子 ===
let activeFader = null, faderStartY = 0, faderStartVal = 0;

document.querySelectorAll('.fader-track').forEach(track => {
    const pid = track.dataset.p;
    const thumb = track.querySelector('.fader-thumb');
    const state = getSliderState(pid);

    const refresh = () => {
        const n = state.getNormalisedValue();
        const h = track.clientHeight;
        thumb.style.bottom = (n * (h - 8)) + 'px';
    };
    state.valueChangedEvent.addListener(refresh);
    state.propertiesChangedEvent.addListener(refresh);
    refresh();

    track.addEventListener('mousedown', e => {
        activeFader = { track, thumb, state, pid };
        faderStartY = e.clientY;
        faderStartVal = state.getNormalisedValue();
        state.sliderDragStarted();
        showReadout(pid, faderStartVal);
        e.preventDefault();
    });
});

// === 种子数字（按住拖动） ===
let activeSeed = null, seedStartY = 0, seedStartVal = 0;

document.querySelectorAll('.seed-val').forEach(el => {
    const pid = el.dataset.p;
    const state = getSliderState(pid);

    const refresh = () => {
        const n = state.getNormalisedValue();
        el.textContent = fmt(pid, n);
    };
    state.valueChangedEvent.addListener(refresh);
    state.propertiesChangedEvent.addListener(refresh);
    refresh();

    el.addEventListener('mousedown', e => {
        activeSeed = { el, state, pid };
        seedStartY = e.clientY;
        seedStartVal = state.getNormalisedValue();
        state.sliderDragStarted();
        showReadout(pid, seedStartVal);
        e.preventDefault();
    });
});

// 种子箭头微调（所有种子同时 +1 / -1）
const seedParams = ['seed_tap', 'seed_diffusion', 'seed_delay', 'seed_post_diffusion'];
document.getElementById('seed-next')?.addEventListener('click', () => {
    seedParams.forEach(pid => {
        const s = getSliderState(pid);
        const step = 1 / 999;
        s.sliderDragStarted();
        s.setNormalisedValue(Math.min(1, s.getNormalisedValue() + step));
        s.sliderDragEnded();
    });
});
document.getElementById('seed-prev')?.addEventListener('click', () => {
    seedParams.forEach(pid => {
        const s = getSliderState(pid);
        const step = 1 / 999;
        s.sliderDragStarted();
        s.setNormalisedValue(Math.max(0, s.getNormalisedValue() - step));
        s.sliderDragEnded();
    });
});
