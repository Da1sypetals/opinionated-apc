import { getSliderState } from "./juce/index.js";

const PARAMS = {
  dry_level: { min: 0, max: 100, unit: "%", decimals: 0 },
  early_level: { min: 0, max: 100, unit: "%", decimals: 0 },
  late_level: { min: 0, max: 100, unit: "%", decimals: 0 },
  size: { min: 10, max: 60, unit: " m", decimals: 0 },
  width: { min: 50, max: 150, unit: "%", decimals: 0 },
  predelay: { min: 0, max: 100, unit: " ms", decimals: 0 },
  diffuse: { min: 0, max: 100, unit: "%", decimals: 0 },
  low_cut: { min: 0, max: 200, unit: " Hz", decimals: 0 },
  low_xo: { min: 200, max: 1200, unit: " Hz", decimals: 0 },
  low_mult: { min: 0.5, max: 2.5, unit: " X", decimals: 1 },
  high_cut: { min: 1000, max: 16000, unit: " Hz", decimals: 0 },
  high_xo: { min: 1000, max: 16000, unit: " Hz", decimals: 0 },
  high_mult: { min: 0.2, max: 1.2, unit: " X", decimals: 1 },
  spin: { min: 0, max: 10, unit: " Hz", decimals: 2 },
  wander: { min: 0, max: 40, unit: " ms", decimals: 1 },
  decay: { min: 0.1, max: 10, unit: " s", decimals: 1 },
  early_send: { min: 0, max: 100, unit: "%", decimals: 0 },
  modulation: { min: 0, max: 100, unit: "%", decimals: 0 },
};

const PARAM_ORDER = Object.keys(PARAMS);
const states = Object.fromEntries(PARAM_ORDER.map(id => [id, getSliderState(id)]));

const BANKS = [
  { name: "Rooms", presets: [
    { name: "Bright Room", values: [80,10,20,10,90,4,90,4,500,0.80,16000,7900,0.75,1.0,25,0.6,20,30] },
    { name: "Clear Room", values: [80,10,20,10,90,4,90,4,500,0.90,13000,5800,0.50,1.0,25,0.6,20,30] },
    { name: "Dark Room", values: [80,10,20,10,90,4,50,4,500,1.20,7300,4900,0.35,1.0,25,0.7,20,30] },
    { name: "Small Chamber", values: [80,10,20,16,80,8,70,4,500,1.10,8200,5500,0.35,1.2,10,0.8,20,20] },
    { name: "Large Chamber", values: [80,10,20,20,80,8,90,4,500,1.30,7000,4900,0.25,1.8,12,1.0,20,20] },
  ] },
  { name: "Studios", presets: [
    { name: "Acoustic Studio", values: [80,10,20,12,90,8,75,4,450,1.50,7600,4900,0.80,2.5,7,0.8,20,20] },
    { name: "Electric Studio", values: [80,10,20,12,90,6,45,4,250,1.25,7600,5800,0.70,2.5,7,0.9,20,30] },
    { name: "Percussion Studio", values: [80,10,20,12,90,6,30,20,200,1.75,5800,5200,0.45,2.5,7,0.7,20,10] },
    { name: "Piano Studio", values: [80,10,20,12,80,8,40,20,600,1.50,8200,5800,0.50,2.8,10,0.7,20,15] },
    { name: "Vocal Studio", values: [80,10,20,12,90,0,60,4,400,1.20,5800,5200,0.40,2.5,7,0.8,20,10] },
  ] },
  { name: "Small Halls", presets: [
    { name: "Small Bright Hall", values: [80,10,20,24,80,12,90,4,400,1.10,11200,6250,0.75,2.5,13,1.3,20,15] },
    { name: "Small Clear Hall", values: [80,10,20,24,100,4,90,4,500,1.30,7600,5500,0.50,3.3,15,1.3,20,15] },
    { name: "Small Dark Hall", values: [80,10,20,24,100,12,60,4,500,1.50,5800,4000,0.35,2.5,10,1.5,20,15] },
    { name: "Small Percussion Hall", values: [80,10,20,24,80,12,40,20,250,2.00,5200,4000,0.35,2.0,13,1.1,20,10] },
    { name: "Small Vocal Hall", values: [80,10,20,24,80,4,60,4,500,1.25,6250,5200,0.35,3.1,15,1.2,20,10] },
  ] },
  { name: "Medium Halls", presets: [
    { name: "Medium Bright Hall", values: [80,10,20,30,100,18,90,4,400,1.25,10000,6400,0.60,2.9,15,1.6,20,15] },
    { name: "Medium Clear Hall", values: [80,10,20,30,100,8,90,4,500,1.50,7600,5500,0.50,2.9,15,1.7,20,15] },
    { name: "Medium Dark Hall", values: [80,10,20,30,100,18,60,4,500,1.75,5800,4000,0.40,2.9,15,1.8,20,15] },
    { name: "Medium Percussion Hall", values: [80,10,20,30,80,12,40,20,300,2.00,5200,4000,0.35,2.0,12,1.2,20,10] },
    { name: "Medium Vocal Hall", values: [80,10,20,32,80,8,75,4,600,1.50,5800,5200,0.40,2.8,16,1.3,20,10] },
  ] },
  { name: "Large Halls", presets: [
    { name: "Large Bright Hall", values: [80,10,20,40,100,20,90,4,400,1.50,8200,5800,0.50,2.1,20,2.5,20,15] },
    { name: "Large Clear Hall", values: [80,10,20,40,100,12,80,4,550,2.00,8200,5200,0.40,2.1,20,2.8,20,15] },
    { name: "Large Dark Hall", values: [80,10,20,40,100,20,60,4,600,2.50,6250,2800,0.20,2.1,20,3.0,20,15] },
    { name: "Large Vocal Hall", values: [80,10,20,40,80,12,80,4,700,2.25,6250,4600,0.30,2.1,17,2.4,20,10] },
    { name: "Great Hall", values: [80,10,20,50,90,20,95,4,750,2.50,5500,4000,0.30,2.6,22,3.8,20,15] },
  ] },
];

function normToValue(id, norm) {
  const p = PARAMS[id];
  return p.min + norm * (p.max - p.min);
}

function valueToNorm(id, value) {
  const p = PARAMS[id];
  return Math.max(0, Math.min(1, (value - p.min) / (p.max - p.min)));
}

function fmt(id, value) {
  const p = PARAMS[id];
  return value.toFixed(p.decimals) + p.unit;
}

function setStateValue(id, value) {
  const state = states[id];
  state.sliderDragStarted();
  state.setNormalisedValue(valueToNorm(id, value));
  state.sliderDragEnded();
}

class Knob {
  constructor(el) {
    this.el = el;
    this.id = el.dataset.param;
    this.state = states[this.id];
    this.arc = el.querySelector(".value-arc");
    this.valueLabel = el.querySelector(".knob-value");
    this.isDragging = false;
    el.addEventListener("mousedown", e => this.start(e));
    window.addEventListener("mousemove", e => this.move(e));
    window.addEventListener("mouseup", () => this.end());
    const refresh = () => this.update(this.state.getNormalisedValue());
    this.state.valueChangedEvent.addListener(refresh);
    this.state.propertiesChangedEvent.addListener(refresh);
    refresh();
  }
  start(e) {
    this.isDragging = true;
    this.startY = e.clientY;
    this.startVal = this.state.getNormalisedValue();
    this.state.sliderDragStarted();
    document.body.style.cursor = "ns-resize";
    e.preventDefault();
  }
  move(e) {
    if (!this.isDragging) return;
    this.state.setNormalisedValue(Math.max(0, Math.min(1, this.startVal + (this.startY - e.clientY) * 0.005)));
  }
  end() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.state.sliderDragEnded();
    document.body.style.cursor = "";
  }
  update(norm) {
    const c = 2 * Math.PI * 28;
    const a = c * 0.75;
    this.arc.style.strokeDasharray = `${a} ${c}`;
    this.arc.style.strokeDashoffset = a - norm * a;
    this.valueLabel.textContent = fmt(this.id, normToValue(this.id, norm));
  }
}

class Fader {
  constructor(col) {
    this.col = col;
    this.id = col.dataset.param;
    this.state = states[this.id];
    this.track = col.querySelector(".fader-track");
    this.handle = col.querySelector(".fader-handle");
    this.fill = col.querySelector(".fader-fill");
    this.valueLabel = col.querySelector(".fader-value");
    this.isDragging = false;
    this.handle.addEventListener("mousedown", e => this.start(e));
    window.addEventListener("mousemove", e => this.move(e));
    window.addEventListener("mouseup", () => this.end());
    const refresh = () => this.update(this.state.getNormalisedValue());
    this.state.valueChangedEvent.addListener(refresh);
    this.state.propertiesChangedEvent.addListener(refresh);
    refresh();
  }
  start(e) {
    this.isDragging = true;
    this.startY = e.clientY;
    this.startVal = this.state.getNormalisedValue();
    this.state.sliderDragStarted();
    document.body.style.cursor = "ns-resize";
    e.preventDefault();
  }
  move(e) {
    if (!this.isDragging) return;
    const h = this.track.querySelector(".fader-groove").clientHeight;
    this.state.setNormalisedValue(Math.max(0, Math.min(1, this.startVal + (this.startY - e.clientY) / h)));
  }
  end() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.state.sliderDragEnded();
    document.body.style.cursor = "";
  }
  update(norm) {
    this.fill.style.height = `${norm * 100}%`;
    this.handle.style.bottom = `calc(${norm * 100}% - 5px)`;
    this.valueLabel.textContent = fmt(this.id, normToValue(this.id, norm));
  }
}

function applyPreset(preset) {
  PARAM_ORDER.forEach((id, i) => setStateValue(id, preset.values[i]));
}

function renderBanks(activeBank = 2, activePreset = 1) {
  const bankCol = document.getElementById("bankCol");
  const presetCol = document.getElementById("presetCol");
  bankCol.innerHTML = "";
  BANKS.forEach((bank, bankIndex) => {
    const tab = document.createElement("div");
    tab.className = `bank-tab${bankIndex === activeBank ? " active" : ""}`;
    tab.textContent = bank.name;
    tab.addEventListener("click", () => {
      renderBanks(bankIndex, 0);
      applyPreset(BANKS[bankIndex].presets[0]);
    });
    bankCol.appendChild(tab);
  });
  presetCol.innerHTML = "";
  BANKS[activeBank].presets.forEach((preset, presetIndex) => {
    const item = document.createElement("div");
    item.className = `preset-item${presetIndex === activePreset ? " active" : ""}`;
    item.textContent = preset.name;
    item.addEventListener("click", () => {
      presetCol.querySelectorAll(".preset-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      applyPreset(preset);
    });
    presetCol.appendChild(item);
  });
}

function decodeColumn(text, bins) {
  const binary = atob(text);
  const out = new Uint8Array(bins);
  for (let i = 0; i < bins; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function drawSpectrogram(payload) {
  const canvas = document.getElementById("spectrogramCanvas");
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!payload || !payload.data) return;
  const mL = 40, mT = 6, mR = 8, mB = 14;
  const plotW = rect.width - mL - mR;
  const plotH = rect.height - mT - mB;
  const colW = plotW / payload.columns;
  for (let x = 0; x < payload.columns; x++) {
    const column = decodeColumn(payload.data[x], payload.bins);
    for (let y = 0; y < payload.bins; y++) {
      const a = column[y] / 255;
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a * 0.85)})`;
      const yy = mT + plotH - ((y + 1) / payload.bins) * plotH;
      ctx.fillRect(mL + x * colW, yy, Math.ceil(colW), Math.ceil(plotH / payload.bins));
    }
  }
}

window.__dragonflyViz = function(json) {
  drawSpectrogram(JSON.parse(json));
};

document.addEventListener("DOMContentLoaded", () => {
  renderBanks();
  document.querySelectorAll(".knob-container").forEach(el => new Knob(el));
  document.querySelectorAll(".fader-col").forEach(el => new Fader(el));
  drawSpectrogram(null);
});
