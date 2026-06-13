import { getSliderState, getToggleState } from "./juce/index.js";
import { drawKnob } from "./knob.js";
import { fmt, denormalize } from "./format.js";
import { Meter } from "./viz/meter.js";

const DPR = window.devicePixelRatio || 1;
const STYLES = ['CLEAN', 'CLASSIC', 'OPTICAL', 'VOCAL'];
const curveParams = { th: -32, rat: 3, knee: 8 };

// ═══ 旋钮绑定 ═══
let activeKnob = null, knobStartY = 0, knobStartVal = 0;

document.querySelectorAll('.kc').forEach(c => {
    const pid = c.dataset.p;
    c._sz = parseInt(c.dataset.sz);
    const state = getSliderState(pid);
    const valEl = document.getElementById('val-' + pid);

    const refresh = () => {
        const n = state.getNormalisedValue();
        drawKnob(c, n);
        if (valEl) valEl.textContent = fmt(pid, n);
        updateCurveParam(pid, n);
    };
    state.valueChangedEvent.addListener(refresh);
    state.propertiesChangedEvent.addListener(refresh);
    refresh();

    c.addEventListener('mousedown', e => {
        activeKnob = { canvas: c, state, pid };
        knobStartY = e.clientY;
        knobStartVal = state.getNormalisedValue();
        state.sliderDragStarted();
        e.preventDefault();
    });
    c.addEventListener('dblclick', () => {
        state.sliderDragStarted();
        state.setNormalisedValue(state.getProperties().defaultValue ?? 0.5);
        state.sliderDragEnded();
    });
    c.addEventListener('wheel', e => {
        e.preventDefault();
        const nv = Math.max(0, Math.min(1, state.getNormalisedValue() - e.deltaY * 0.002));
        state.sliderDragStarted();
        state.setNormalisedValue(nv);
        state.sliderDragEnded();
    }, { passive: false });
});

document.addEventListener('mousemove', e => {
    if (!activeKnob) return;
    const sens = e.shiftKey ? 0.001 : 0.005;
    const nv = Math.max(0, Math.min(1, knobStartVal + (knobStartY - e.clientY) * sens));
    activeKnob.state.setNormalisedValue(nv);
});
document.addEventListener('mouseup', () => {
    if (activeKnob) { activeKnob.state.sliderDragEnded(); activeKnob = null; }
});

// ═══ Bar slider 绑定 ═══
let activeBar = null, barStartY = 0, barStartVal = 0;

document.querySelectorAll('.bar-slider').forEach(bar => {
    const pid = bar.dataset.p;
    const state = getSliderState(pid);
    const fillEl = bar.querySelector('.bar-fill');
    const valEl = document.getElementById('val-' + pid);

    const refresh = () => {
        const n = state.getNormalisedValue();
        fillEl.style.width = (n * 100) + '%';
        if (valEl) valEl.textContent = fmt(pid, n);
        updateCurveParam(pid, n);
    };
    state.valueChangedEvent.addListener(refresh);
    state.propertiesChangedEvent.addListener(refresh);
    refresh();

    bar.addEventListener('mousedown', e => {
        activeBar = { bar, state, pid };
        barStartY = e.clientY;
        barStartVal = state.getNormalisedValue();
        state.sliderDragStarted();
        e.preventDefault();
    });
});

document.addEventListener('mousemove', e => {
    if (!activeBar) return;
    const sens = e.shiftKey ? 0.001 : 0.006;
    const nv = Math.max(0, Math.min(1, barStartVal + (barStartY - e.clientY) * sens));
    activeBar.state.setNormalisedValue(nv);
});
document.addEventListener('mouseup', () => {
    if (activeBar) { activeBar.state.sliderDragEnded(); activeBar = null; }
});

// ═══ Toggle 按钮绑定 ═══
function bindToggle(btnId, paramId, labelOn, labelOff) {
    const btn = document.getElementById(btnId);
    const state = getToggleState(paramId);
    const refresh = () => {
        const on = state.getValue();
        btn.classList.toggle('on', on);
        if (labelOn && labelOff) btn.textContent = on ? labelOn : labelOff;
    };
    state.valueChangedEvent.addListener(refresh);
    refresh();
    btn.addEventListener('click', () => state.setValue(!state.getValue()));
}

bindToggle('btnRms', 'rms_on', 'RMS', 'RMS');
bindToggle('btnInf', 'range_inf', 'INF', 'INF');
bindToggle('btnStereo', 'stereo_mode', 'L/R', 'M/S');

// Bypass LED
const bypassState = getToggleState('bypass');
const led = document.getElementById('bypassLed');
const refreshBypass = () => { led.classList.toggle('off', !bypassState.getValue()); };
bypassState.valueChangedEvent.addListener(refreshBypass);
refreshBypass();
led.addEventListener('click', () => bypassState.setValue(!bypassState.getValue()));

// Style (slider 0-1 → 0-3)
const styleState = getSliderState('style');
const styleBtn = document.getElementById('btnStyle');
const refreshStyle = () => {
    const idx = Math.round(denormalize('style', styleState.getNormalisedValue()));
    styleBtn.textContent = STYLES[idx] || 'CLEAN';
};
styleState.valueChangedEvent.addListener(refreshStyle);
styleState.propertiesChangedEvent.addListener(refreshStyle);
refreshStyle();
styleBtn.addEventListener('click', () => {
    const cur = Math.round(denormalize('style', styleState.getNormalisedValue()));
    const next = (cur + 1) % 4;
    styleState.sliderDragStarted();
    styleState.setNormalisedValue(next / 3);
    styleState.sliderDragEnded();
});

// ═══ GR 可视化 ═══
const grHistory = new Float32Array(80);
const inHistory = new Float32Array(80);
const reducedHistory = new Float32Array(80);
const outHistory = new Float32Array(80);
inHistory.fill(-72);
reducedHistory.fill(-72);
outHistory.fill(-72);
const grValEl = document.getElementById('grVal');
const meterInEl = document.getElementById('meterIn');
const meterOutEl = document.getElementById('meterOut');
const srDisplay = document.getElementById('sampleRateDisplay');
const latDisplay = document.getElementById('latencyDisplay');

window.__zlcompViz = function(json, audioActive = true) {
    let d;
    try { d = JSON.parse(json); } catch(e) { return; }

    const gr = audioActive ? Math.max(Math.abs(d.gr_l || 0), Math.abs(d.gr_r || 0)) : 0;
    grHistory.copyWithin(0, 1);
    grHistory[grHistory.length - 1] = gr;
    grValEl.textContent = gr > 0.05 ? ('-' + gr.toFixed(1) + ' dB') : '0.0 dB';

    const nextIn = audioActive && Number.isFinite(d.in_db) ? clampDb(d.in_db) : -72;
    const nextOut = audioActive && Number.isFinite(d.out_db) ? clampDb(d.out_db) : -72;
    const nextReduced = audioActive ? clampDb(nextIn - gr) : -72;
    const prevIn = inHistory[inHistory.length - 1] ?? -72;
    const prevReduced = reducedHistory[reducedHistory.length - 1] ?? -72;
    const prevOut = outHistory[outHistory.length - 1] ?? -72;
    const smoothIn = prevIn + (nextIn - prevIn) * 0.35;
    const smoothReduced = prevReduced + (nextReduced - prevReduced) * 0.35;
    const smoothOut = prevOut + (nextOut - prevOut) * 0.35;
    inHistory.copyWithin(0, 1);
    reducedHistory.copyWithin(0, 1);
    outHistory.copyWithin(0, 1);
    inHistory[inHistory.length - 1] = smoothIn;
    reducedHistory[reducedHistory.length - 1] = smoothReduced;
    outHistory[outHistory.length - 1] = smoothOut;

    meterInEl.style.height = levelPct(smoothIn) + '%';
    meterOutEl.style.height = levelPct(smoothOut) + '%';

    if (d.sr) srDisplay.textContent = (d.sr / 1000) + ' kHz';
    if (d.lat !== undefined) latDisplay.textContent = 'LATENCY: ' + d.lat + ' smp';

    drawGR();
    drawCurve();
};

// ═══ I/O Curve ═══
function updateCurveParam(pid, norm) {
    if (pid === 'threshold') curveParams.th = denormalize(pid, norm);
    else if (pid === 'ratio') curveParams.rat = denormalize(pid, norm);
    else if (pid === 'knee') curveParams.knee = denormalize(pid, norm);
    else return;
    drawCurve();
}

function clampDb(db) {
    return Math.max(-72, Math.min(0, db));
}

function levelPct(db) {
    return Math.max(0, Math.min(100, ((clampDb(db) + 72) / 72) * 100));
}

function drawCurve() {
    const cv = document.getElementById('cvCurve');
    const s = 200;
    cv.width = s * DPR; cv.height = s * DPR;
    cv.style.width = s + 'px'; cv.style.height = s + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const p = 14, w = s - p * 2;
    const { th, rat, knee } = curveParams;
    const dMin = -72, dMax = 0;
    const dx = db => p + (db - dMin) / (dMax - dMin) * w;
    const dy = db => p + w - (db - dMin) / (dMax - dMin) * w;
    const comp = d => { const h = knee / 2; if (d < th - h) return d; if (d > th + h) return th + (d - th) / rat; const x = d - th + h; return d + ((1/rat - 1) * x * x) / (2 * knee); };

    ctx.strokeStyle = 'rgba(75,163,212,0.04)'; ctx.lineWidth = 0.5;
    for (let d = dMin; d <= dMax; d += 12) { const x = dx(d), y = dy(d); ctx.beginPath(); ctx.moveTo(x, p); ctx.lineTo(x, p+w); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p, y); ctx.lineTo(p+w, y); ctx.stroke(); }

    ctx.setLineDash([2,3]); ctx.strokeStyle = 'rgba(75,163,212,0.1)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(p, p+w); ctx.lineTo(p+w, p); ctx.stroke(); ctx.setLineDash([]);

    ctx.setLineDash([2,2]); ctx.strokeStyle = 'rgba(212,148,62,0.3)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(dx(th), p); ctx.lineTo(dx(th), p+w); ctx.stroke(); ctx.setLineDash([]);

    ctx.beginPath(); ctx.moveTo(dx(dMin), dy(comp(dMin)));
    for (let d = dMin; d <= dMax; d += 0.5) ctx.lineTo(dx(d), dy(comp(d)));
    ctx.lineTo(dx(dMax), dy(dMin)); ctx.lineTo(dx(dMin), dy(dMin)); ctx.closePath();
    ctx.fillStyle = 'rgba(212,148,62,0.04)'; ctx.fill();

    ctx.beginPath(); ctx.moveTo(dx(dMin), dy(comp(dMin)));
    for (let d = dMin; d <= dMax; d += 0.5) ctx.lineTo(dx(d), dy(comp(d)));
    ctx.strokeStyle = '#d4943e'; ctx.lineWidth = 1.8; ctx.stroke();
}

// ═══ GR Timeline ═══
function drawGR() {
    const cv = document.getElementById('cvGR');
    const rect = cv.parentElement.getBoundingClientRect();
    const w = cv.clientWidth || rect.width - 16;
    const h = cv.clientHeight || rect.height - 28;
    if (w < 1 || h < 1) return;
    cv.width = w * DPR; cv.height = h * DPR;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const n = grHistory.length;
    const px = 4, py = 4, pw = w - px*2, ph = h - py*2;
    const xAt = i => px + (i / (n - 1)) * pw;
    const yLevel = db => py + ph - levelPct(db) * 0.01 * ph;
    const yGR = db => py + Math.min(1, db / 20) * ph;

    ctx.strokeStyle = 'rgba(75,163,212,0.05)';
    ctx.lineWidth = 0.5;
    for (let db = -60; db <= -12; db += 12) {
        const y = yLevel(db);
        ctx.beginPath();
        ctx.moveTo(px, y);
        ctx.lineTo(px + pw, y);
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(px, py + ph);
    for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), yLevel(reducedHistory[i]));
    ctx.lineTo(px + pw, py + ph);
    ctx.closePath();
    ctx.fillStyle = 'rgba(75, 163, 212, 0.20)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(px, yLevel(inHistory[0]));
    for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), yLevel(inHistory[i]));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(xAt(i), yLevel(reducedHistory[i]));
    ctx.closePath();
    ctx.fillStyle = 'rgba(235, 230, 205, 0.36)';
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yLevel(inHistory[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(235, 230, 205, 0.55)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yLevel(reducedHistory[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#4ba3d4';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yGR(grHistory[i]);
        i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.strokeStyle = '#d45040'; ctx.lineWidth = 1.2; ctx.stroke();
}

drawCurve();
