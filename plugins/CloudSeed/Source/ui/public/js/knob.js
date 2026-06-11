const SA = Math.PI * 0.75;
const EA = Math.PI * 2.25;
const ARC = EA - SA;
const DPR = window.devicePixelRatio || 1;

export function drawKnob(c, val) {
    const sz = c._sz;
    c.width = sz * DPR;
    c.height = sz * DPR;
    c.style.width = sz + 'px';
    c.style.height = sz + 'px';

    const ctx = c.getContext('2d');
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, sz, sz);

    const cx = sz / 2, cy = sz / 2, r = sz * 0.36;

    // 旋钮主体（渐变圆 + 阴影）
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;
    const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.2, r * 0.05, cx, cy, r);
    g.addColorStop(0, '#e2ecf4');
    g.addColorStop(0.6, '#cad5df');
    g.addColorStop(1, '#b5c4cf');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    const trackR = r + 5;

    // 弧形轨道背景
    ctx.beginPath();
    ctx.arc(cx, cy, trackR, SA, EA);
    ctx.strokeStyle = 'rgba(80,110,130,0.2)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 弧形填充
    const va = SA + val * ARC;
    if (val > 0.005) {
        ctx.beginPath();
        ctx.arc(cx, cy, trackR, SA, va);
        ctx.strokeStyle = '#3b5e77';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    // 指示线
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(va) * r * 0.5, cy + Math.sin(va) * r * 0.5);
    ctx.lineTo(cx + Math.cos(va) * r * 0.88, cy + Math.sin(va) * r * 0.88);
    ctx.strokeStyle = '#3b5e77';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
}
