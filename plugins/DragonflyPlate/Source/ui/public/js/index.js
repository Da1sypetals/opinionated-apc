import { getSliderState } from "./juce/index.js";

const PARAMS = {
  dry_level: { min: 0, max: 100, unit: "%", decimals: 0 },
  wet_level: { min: 0, max: 100, unit: "%", decimals: 0 },
  algorithm: { min: 0, max: 2, unit: "", decimals: 0 },
  width: { min: 50, max: 150, unit: "%", decimals: 0 },
  predelay: { min: 0, max: 100, unit: " ms", decimals: 0 },
  decay: { min: 0.1, max: 10, unit: " s", decimals: 1 },
  low_cut: { min: 0, max: 200, unit: " Hz", decimals: 0 },
  high_cut: { min: 1000, max: 16000, unit: " Hz", decimals: 0 },
  damp: { min: 1000, max: 16000, unit: " Hz", decimals: 0 },
};

const PRESETS = [
  { name: "Abrupt Plate", values: [80, 20, 1, 100, 20, 0.2, 50, 10000, 7000] },
  { name: "Bright Plate", values: [80, 20, 1, 100, 0, 0.4, 200, 16000, 13000] },
  { name: "Clear Plate", values: [80, 20, 1, 100, 0, 0.6, 100, 13000, 7000] },
  { name: "Dark Plate", values: [80, 20, 1, 100, 0, 0.8, 50, 7000, 4000] },
  { name: "Foil Tray", values: [80, 20, 0, 50, 0, 0.3, 200, 16000, 13000] },
  { name: "Metal Roof", values: [80, 20, 0, 120, 20, 0.5, 100, 13000, 10000] },
  { name: "Narrow Tank", values: [80, 20, 2, 60, 10, 0.6, 50, 10000, 7000] },
  { name: "Phat Tank", values: [80, 20, 2, 150, 10, 1.0, 50, 10000, 4000] },
];

const PARAM_ORDER = Object.keys(PARAMS);
const states = Object.fromEntries(PARAM_ORDER.map(id => [id, getSliderState(id)]));
const algorithmNames = ["Simple", "Nested", "Tank"];

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
    const next = Math.max(0, Math.min(1, this.startVal + (this.startY - e.clientY) * 0.005));
    this.state.setNormalisedValue(next);
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
    const next = Math.max(0, Math.min(1, this.startVal + (this.startY - e.clientY) / h));
    this.state.setNormalisedValue(next);
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

function renderPresetList() {
  const grid = document.getElementById("presetGrid");
  grid.innerHTML = "";
  const order = [0, 4, 1, 5, 2, 6, 3, 7];
  for (const idx of order) {
    const preset = PRESETS[idx];
    const item = document.createElement("div");
    item.className = "preset-item";
    item.textContent = preset.name;
    item.addEventListener("click", () => {
      document.querySelectorAll(".preset-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      applyPreset(preset);
    });
    if (preset.name === "Bright Plate") item.classList.add("active");
    grid.appendChild(item);
  }
}

function renderAlgorithms() {
  const list = document.getElementById("algorithmList");
  list.innerHTML = "";
  algorithmNames.forEach((name, idx) => {
    const item = document.createElement("div");
    item.className = "algorithm-item";
    item.textContent = name;
    item.addEventListener("click", () => setStateValue("algorithm", idx));
    list.appendChild(item);
  });
  const refresh = () => {
    const idx = Math.round(normToValue("algorithm", states.algorithm.getNormalisedValue()));
    list.querySelectorAll(".algorithm-item").forEach((item, i) => item.classList.toggle("active", i === idx));
  };
  states.algorithm.valueChangedEvent.addListener(refresh);
  states.algorithm.propertiesChangedEvent.addListener(refresh);
  refresh();
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

  const mL = 44, mT = 8, mR = 10, mB = 16;
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
  renderPresetList();
  renderAlgorithms();
  document.querySelectorAll(".knob-container").forEach(el => new Knob(el));
  document.querySelectorAll(".fader-col").forEach(el => new Fader(el));
  drawSpectrogram(null);
});
