import { getSliderState, getToggleState } from "./juce/index.js";

// SVG 旋钮渲染
const ARC_START = 135;
const ARC_END = 405;
const ARC_RANGE = ARC_END - ARC_START;

function createKnobSVG() {
    const size = 40;
    const cx = size / 2;
    const cy = size / 2;
    const r = 15;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.classList.add("knob-svg");

    // 背景圆弧
    const trackPath = describeArc(cx, cy, r, ARC_START, ARC_END);
    const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
    track.setAttribute("d", trackPath);
    track.classList.add("knob-track");
    svg.appendChild(track);

    // 填充圆弧
    const fill = document.createElementNS("http://www.w3.org/2000/svg", "path");
    fill.setAttribute("d", trackPath);
    fill.classList.add("knob-fill");
    svg.appendChild(fill);

    // 指示点
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", "2.5");
    dot.classList.add("knob-dot");
    svg.appendChild(dot);

    return svg;
}

function describeArc(cx, cy, r, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function updateKnobVisual(svg, normValue) {
    const size = 40;
    const cx = size / 2;
    const cy = size / 2;
    const r = 15;

    const fillAngle = ARC_START + normValue * ARC_RANGE;
    const fillPath = svg.querySelector(".knob-fill");
    const dot = svg.querySelector(".knob-dot");

    if (normValue < 0.001) {
        fillPath.setAttribute("d", "");
    } else {
        fillPath.setAttribute("d", describeArc(cx, cy, r, ARC_START, fillAngle));
    }

    const dotPos = polarToCartesian(cx, cy, r - 6, fillAngle);
    dot.setAttribute("cx", dotPos.x);
    dot.setAttribute("cy", dotPos.y);
}

// 旋钮交互处理
function setupKnobInteraction(container, sliderState) {
    let isDragging = false;
    let startY = 0;
    let startValue = 0;

    container.addEventListener("mousedown", (e) => {
        isDragging = true;
        startY = e.clientY;
        startValue = sliderState.getNormalisedValue();
        sliderState.sliderDragStarted();
        e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const dy = startY - e.clientY;
        const sensitivity = e.shiftKey ? 0.001 : 0.005;
        const newValue = Math.max(0, Math.min(1, startValue + dy * sensitivity));
        sliderState.setNormalisedValue(newValue);
    });

    window.addEventListener("mouseup", () => {
        if (isDragging) {
            isDragging = false;
            sliderState.sliderDragEnded();
        }
    });

    // 双击重置
    container.addEventListener("dblclick", () => {
        sliderState.sliderDragStarted();
        sliderState.setNormalisedValue(sliderState.properties.start);
        sliderState.sliderDragEnded();
    });
}

// 参数值显示格式化
function formatParamValue(paramId, normValue) {
    const v = normValue;

    // 响应曲线辅助函数
    const resp1dec = (x) => Math.pow(10, x) * (10/9*0.1) - (10/9*0.1);
    const resp2dec = (x) => Math.pow(10, 2*x) * (100/99*0.01) - (100/99*0.01);
    const resp3dec = (x) => Math.pow(10, 3*x) * (1000/999*0.001) - (1000/999*0.001);
    const resp4oct = (x) => Math.pow(2, 4*x) * (16/15*0.0625) - (16/15*0.0625);
    const resp3oct = (x) => Math.pow(2, 3*x) * (8/7*0.125) - (8/7*0.125);

    switch (paramId) {
        case "input_mix":
        case "early_diffuse_feedback":
        case "tap_decay":
        case "late_diffuse_feedback":
        case "eq_cross_seed":
            return `${Math.round(v * 100)}%`;

        case "early_diffuse_mod_amount":
        case "late_line_mod_amount":
        case "late_diffuse_mod_amount":
            return `${Math.round(v * 250)}%`;

        case "low_cut":
            return `${Math.round(20 + resp4oct(v) * 980)} Hz`;
        case "high_cut":
        case "eq_high_freq":
        case "eq_cutoff":
            return `${Math.round(400 + resp4oct(v) * 19600)} Hz`;
        case "eq_low_freq":
            return `${Math.round(20 + resp3oct(v) * 980)} Hz`;

        case "dry_out":
        case "early_out":
        case "late_out": {
            const db = -30 + v * 30;
            return db <= -30 ? "MUTED" : `${db.toFixed(1)} dB`;
        }

        case "eq_low_gain":
        case "eq_high_gain": {
            const db = -20 + v * 20;
            return `${db.toFixed(1)} dB`;
        }

        case "tap_count":
            return `${Math.round(1 + v * 255)}`;
        case "early_diffuse_count":
            return `${Math.round(1 + v * 11)}`;
        case "late_line_count":
            return `${Math.round(1 + v * 11)}`;
        case "late_diffuse_count":
            return `${Math.round(1 + v * 7)}`;

        case "tap_predelay":
            return `${Math.round(resp1dec(v) * 500)} ms`;
        case "tap_length":
            return `${Math.round(10 + v * 990)} ms`;
        case "early_diffuse_delay":
            return `${Math.round(10 + v * 90)} ms`;
        case "late_line_size":
            return `${Math.round(20 + resp2dec(v) * 980)} ms`;
        case "late_diffuse_delay":
            return `${Math.round(10 + v * 90)} ms`;

        case "late_line_decay": {
            const s = 0.05 + resp3dec(v) * 59.95;
            if (s < 1) return `${Math.round(s * 1000)} ms`;
            if (s < 10) return `${s.toFixed(2)} s`;
            return `${s.toFixed(1)} s`;
        }

        case "early_diffuse_mod_rate":
        case "late_line_mod_rate":
        case "late_diffuse_mod_rate":
            return `${(resp2dec(v) * 5).toFixed(2)} Hz`;

        case "seed_tap":
        case "seed_diffusion":
        case "seed_delay":
        case "seed_post_diffusion":
            return `${Math.floor(v * 999).toString().padStart(3, '0')}`;

        default:
            return `${Math.round(v * 100)}%`;
    }
}

// 初始化所有控件
function initUI() {
    const paramCells = document.querySelectorAll(".param-cell");

    paramCells.forEach((cell) => {
        const paramId = cell.dataset.param;
        const type = cell.dataset.type;
        const valueDisplay = cell.querySelector(".param-value");

        if (type === "slider") {
            const knobContainer = cell.querySelector(".knob-container");
            const svg = createKnobSVG();
            knobContainer.appendChild(svg);

            const sliderState = getSliderState(paramId);

            const updateDisplay = () => {
                const norm = sliderState.getNormalisedValue();
                updateKnobVisual(svg, norm);
                valueDisplay.textContent = formatParamValue(paramId, norm);
            };

            sliderState.valueChangedEvent.addListener(updateDisplay);
            sliderState.propertiesChangedEvent.addListener(updateDisplay);
            setupKnobInteraction(knobContainer, sliderState);

            // 初始更新
            updateDisplay();
        } else if (type === "toggle") {
            const toggleContainer = cell.querySelector(".toggle-container");
            const toggleState = getToggleState(paramId);

            const updateDisplay = () => {
                const isOn = toggleState.getValue();
                toggleContainer.classList.toggle("active", isOn);
                if (paramId === "late_mode") {
                    valueDisplay.textContent = isOn ? "POST" : "PRE";
                } else {
                    valueDisplay.textContent = isOn ? "ON" : "OFF";
                }
            };

            toggleState.valueChangedEvent.addListener(updateDisplay);
            toggleContainer.addEventListener("click", () => {
                toggleState.setValue(!toggleState.getValue());
            });

            updateDisplay();
        }
    });
}

// 等待 JUCE backend 就绪后初始化
if (window.__JUCE__) {
    initUI();
} else {
    window.addEventListener("load", initUI);
}
