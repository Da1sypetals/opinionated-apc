import { getSliderState, getToggleState } from "./juce/index.js";
import { drawKnob } from "./knob.js";
import { fmt, fmtDesc } from "./format.js";
import { SpectrumAnalyzer } from "./viz/spectrum.js";
import { GrTimeline } from "./viz/timeline.js";
import { Meter } from "./viz/meter.js";

// ═══ Tooltip：定位在目标控件正上方 ═══
const tt = document.getElementById('tt');
let ttT;

function positionTipAbove(el) {
    const r = el.getBoundingClientRect();
    tt.style.left = (r.left + r.width / 2) + 'px';
    tt.style.top = (r.top - 8) + 'px';
}

// 拖动/滚动时：在旋钮上方显示当前数值
function showValueTip(el, pid, norm) {
    clearTimeout(ttT);
    tt.className = 'value';
    tt.textContent = fmt(pid, norm);
    positionTipAbove(el);
    tt.style.opacity = '1';
}

// 悬浮时：在旋钮上方显示英文用途说明
function showDescTip(el, pid) {
    clearTimeout(ttT);
    tt.className = 'desc';
    tt.textContent = fmtDesc(pid);
    positionTipAbove(el);
    tt.style.opacity = '1';
}

function hideTip(delay = 0) {
    clearTimeout(ttT);
    if (delay > 0) ttT = setTimeout(() => tt.style.opacity = '0', delay);
    else tt.style.opacity = '0';
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
        showValueTip(c, pid, knobStartVal);
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
        showValueTip(c, pid, nv);
        hideTip(900);
    }, { passive: false });

    // 悬浮：显示英文用途说明（拖动中不打断数值显示）
    c.addEventListener('mouseenter', () => {
        if (!activeKnob) showDescTip(c, pid);
    });
    c.addEventListener('mouseleave', () => {
        if (!activeKnob) hideTip();
    });
});

document.addEventListener('mousemove', e => {
    if (!activeKnob) return;
    const sens = e.shiftKey ? 0.001 : 0.005;
    const nv = Math.max(0, Math.min(1, knobStartVal + (knobStartY - e.clientY) * sens));
    activeKnob.state.setNormalisedValue(nv);
    showValueTip(activeKnob.canvas, activeKnob.pid, nv);
});
document.addEventListener('mouseup', () => {
    if (activeKnob) {
        activeKnob.state.sliderDragEnded();
        activeKnob = null;
        hideTip(700);
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
    fMin: 20, fMax: 20000, dbMin: -90, dbMax: 6, binCount: 192,
    series: [
        { key: 'input', color: 'rgba(120,170,200,0.5)', lineWidth: 1.1 },
        {
            key: 'output', color: '#5ac8e0', lineWidth: 1.8, fill: true,
            fillTopColor: 'rgba(90,200,224,0.30)', fillBottomColor: 'rgba(90,200,224,0.02)',
        },
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
