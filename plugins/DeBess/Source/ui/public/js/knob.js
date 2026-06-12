const SA = Math.PI * 0.75;
const EA = Math.PI * 2.25;
const ARC = EA - SA;
const DPR = window.devicePixelRatio || 1;

// 每个参数对应的弧色
const KNOB_COLORS = {
    intensity: { arc: '#e8445a', glow: 'rgba(232,68,90,0.3)' },
    sharpness: { arc: '#f0a030', glow: 'rgba(240,160,48,0.3)' },
    depth:     { arc: '#5ac8e0', glow: 'rgba(90,200,224,0.3)' },
    filter:    { arc: '#30b868', glow: 'rgba(48,184,104,0.3)' },
};

export function drawKnob(c, val) {
    const sz = c._sz;
    c.width = sz * DPR;
    c.height = sz * DPR;
    c.style.width = sz + 'px';
    c.style.height = sz + 'px';

    const ctx = c.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, sz, sz);

    const cx = sz / 2, cy = sz / 2, r = sz * 0.32;
    const trackR = r + 6;
    const key = c.dataset.p;
    const col = KNOB_COLORS[key] || { arc: '#5ac8e0', glow: 'rgba(90,200,224,0.3)' };

    // 旋钮主体
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.05, cx, cy, r);
    g.addColorStop(0, '#2a3a48');
    g.addColorStop(0.7, '#1e2a34');
    g.addColorStop(1, '#162028');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,200,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 弧形轨道背景
    ctx.beginPath();
    ctx.arc(cx, cy, trackR, SA, EA);
    ctx.strokeStyle = 'rgba(40,60,80,0.4)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 弧形填充
    const va = SA + val * ARC;
    if (val > 0.005) {
        ctx.save();
        ctx.shadowColor = col.glow;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, trackR, SA, va);
        ctx.strokeStyle = col.arc;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
    }

    // 指示线
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(va) * r * 0.45, cy + Math.sin(va) * r * 0.45);
    ctx.lineTo(cx + Math.cos(va) * r * 0.85, cy + Math.sin(va) * r * 0.85);
    ctx.strokeStyle = col.arc;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
}
