import { getSliderState, getToggleState } from "./juce/index.js";
import { drawKnob } from "./knob.js";
import { fmt, fmtLabel } from "./format.js";
import { SpectrumAnalyzer } from "./viz/spectrum.js";
import { GrTimeline } from "./viz/timeline.js";
import { Meter } from "./viz/meter.js";

// ═══ Tooltip ═══
const tt = document.getElementById('tt');
let ttT;
function showTip(pid, norm) {
    tt.textContent = fmtLabel(pid) + ': ' + fmt(pid, norm);
}

// ═══ 旋钮（绑定 JUCE slider relay） ═══
let activeKnob = null, knobStartY = 0, knobStartVal = 0;

document.querySelectorAll('.kc').forEach(c => {
    const pid = c.dataset.p;
    c._sz = 56;
    const state = getSliderState(pid);
    const valEl = document.getElementById('val-' + pid);

    const refresh = () => {
        const n = state.getNormalisedValue();
        drawKnob(c, n);
        if (valEl) valEl.textContent = fmt(pid, n);
    };
    state.valueChangedEvent.addListener(refresh);
    state.propertiesChangedEvent.addListener(refresh);
    refresh();

    c.addEventListener('mousedown', e => {
        activeKnob = { canvas: c, state, pid };
        knobStartY = e.clientY;
        knobStartVal = state.getNormalisedValue();
        state.sliderDragStarted();
        showTip(pid, knobStartVal);
        e.preventDefault();
    });
    c.addEventListener('dblclick', () => {
        state.sliderDragStarted();
        state.setNormalisedValue(pid === 'intensity' ? 0.0 : 0.5);
        state.sliderDragEnded();
    });
    c.addEventListener('wheel', e => {
        e.preventDefault();
        const nv = Math.max(0, Math.min(1, state.getNormalisedValue() - e.deltaY * 0.002));
        state.sliderDragStarted();
        state.setNormalisedValue(nv);
        state.sliderDragEnded();
        showTip(pid, nv);
    }, { passive: false });
});

document.addEventListener('mousemove', e => {
    if (!activeKnob) return;
    const sens = e.shiftKey ? 0.001 : 0.005;
    const nv = Math.max(0, Math.min(1, knobStartVal + (knobStartY - e.clientY) * sens));
    activeKnob.state.setNormalisedValue(nv);
    showTip(activeKnob.pid, nv);
    tt.style.opacity = '1';
    clearTimeout(ttT);
});
document.addEventListener('mouseup', () => {
    if (activeKnob) {
        activeKnob.state.sliderDragEnded();
        activeKnob = null;
        ttT = setTimeout(() => tt.style.opacity = '0', 800);
    }
});

// ═══ Sense Mon（绑定 JUCE toggle relay） ═══
const monBtn = document.getElementById('monBtn');
const monLabel = document.getElementById('monLabel');
const monState = getToggleState('sense_mon');

function refreshMon() {
    const on = monState.getValue();
    monBtn.classList.toggle('active', on);
    monLabel.classList.toggle('active-label', on);
    monBtn.querySelectorAll('path, circle').forEach(el =>
        el.setAttribute('stroke', on ? '#e8445a' : '#4a6878'));
}
monState.valueChangedEvent.addListener(refreshMon);
refreshMon();
monBtn.addEventListener('click', () => monState.setValue(!monState.getValue()));

// ═══ 可视化组件 ═══
const spectrum = new SpectrumAnalyzer(document.getElementById('spectrumCanvas'), {
    fMin: 20, fMax: 20000, dbMin: -72, dbMax: 6, binCount: 128,
    series: [
        { key: 'input', color: 'rgba(120,170,200,0.55)', lineWidth: 1.2 },
        { key: 'output', color: '#5ac8e0', lineWidth: 1.6 },
    ],
    diffFill: { from: 'input', to: 'output', color: 'rgba(232,68,90,0.16)' },
});

const timeline = new GrTimeline(document.getElementById('grCanvas'), {
    historyLen: 240, grMaxDb: 24,
});

const grMeter = new Meter(document.getElementById('gr-fill'), { smooth: 0.6, decay: 0.04 });
const outMeter = new Meter(document.getElementById('out-fill'), { smooth: 0.5, decay: 0.04 });
const grDbEl = document.getElementById('gr-db');

const GR_MAX_DB = 24;

// ═══ 来自 Rust 的可视化数据（C++ 定时器每帧调用，逻辑全在 Rust 算好） ═══
window.__debessViz = function (json) {
    let d;
    try { d = JSON.parse(json); } catch (e) { return; }

    if (d.in) spectrum.setSeries('input', d.in);
    if (d.out) spectrum.setSeries('output', d.out);

    const gr = d.gr || 0;
    const il = d.il || 0;
    const ol = d.ol || 0;

    timeline.push(gr, il);
    grMeter.set(gr / GR_MAX_DB);
    outMeter.set(ol);
    grDbEl.textContent = '-' + gr.toFixed(1) + ' dB';
};

// ═══ Tab 切换 ═══
let activeView = 'spectrum';
spectrum.start();

document.querySelectorAll('.display-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.display-tab').forEach(t => {
            t.classList.remove('active');
            t.classList.add('inactive');
        });
        tab.classList.remove('inactive');
        tab.classList.add('active');

        activeView = tab.dataset.view;
        const showSpectrum = activeView === 'spectrum';
        document.getElementById('spectrumCanvas').style.display = showSpectrum ? 'block' : 'none';
        document.getElementById('grCanvas').style.display = showSpectrum ? 'none' : 'block';
        document.getElementById('legend-spectrum').style.display = showSpectrum ? 'flex' : 'none';
        document.getElementById('legend-gr').style.display = showSpectrum ? 'none' : 'flex';

        if (showSpectrum) { timeline.stop(); spectrum.start(); }
        else { spectrum.stop(); timeline.start(); }
    });
});
