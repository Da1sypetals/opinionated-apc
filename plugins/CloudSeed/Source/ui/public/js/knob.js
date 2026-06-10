var ARC_START = 135, ARC_END = 405, ARC_RANGE = 270;

function polar(cx, cy, r, deg) {
    var rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx, cy, r, s, e) {
    var a = polar(cx, cy, r, e), b = polar(cx, cy, r, s);
    return "M " + a.x + " " + a.y + " A " + r + " " + r + " 0 " + (e - s > 180 ? "1" : "0") + " 0 " + b.x + " " + b.y;
}

export function makeKnob(el) {
    var sz = 44, cx = sz / 2, cy = sz / 2, r = 16;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + sz + " " + sz);
    svg.setAttribute("width", sz);
    svg.setAttribute("height", sz);

    var track = document.createElementNS(ns, "path");
    track.setAttribute("d", arc(cx, cy, r, ARC_START, ARC_END));
    track.setAttribute("class", "knob-track");
    svg.appendChild(track);

    var fill = document.createElementNS(ns, "path");
    fill.setAttribute("class", "knob-arc");
    svg.appendChild(fill);

    var dot = document.createElementNS(ns, "circle");
    dot.setAttribute("r", "2.5");
    dot.setAttribute("class", "knob-dot");
    svg.appendChild(dot);

    el.appendChild(svg);
    return { svg: svg, fill: fill, dot: dot, cx: cx, cy: cy, r: r };
}

export function updateKnob(k, norm) {
    var angle = ARC_START + norm * ARC_RANGE;
    k.fill.setAttribute("d", norm < 0.002 ? "" : arc(k.cx, k.cy, k.r, ARC_START, angle));
    var p = polar(k.cx, k.cy, k.r - 6, angle);
    k.dot.setAttribute("cx", p.x);
    k.dot.setAttribute("cy", p.y);
}
