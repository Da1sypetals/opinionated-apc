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
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, sz, sz);

    const cx = sz / 2, cy = sz / 2, r = sz * 0.30;
    const trackR = r + (sz > 60 ? 6 : 4);
    const lw = sz > 60 ? 3 : 2.4;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;
    const g = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.15, 0, cx, cy, r);
    g.addColorStop(0, '#2e3a48');
    g.addColorStop(0.8, '#1e2830');
    g.addColorStop(1, '#1a2228');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, trackR, SA, EA);
    ctx.strokeStyle = 'rgba(75,163,212,0.08)';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();

    const va = SA + val * ARC;
    if (val > 0.003) {
        ctx.beginPath();
        ctx.arc(cx, cy, trackR, SA, va);
        ctx.strokeStyle = '#4ba3d4';
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    const dd = r * 0.6, dr = sz > 60 ? 2.8 : 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(va) * dd, cy + Math.sin(va) * dd, dr, 0, Math.PI * 2);
    ctx.fillStyle = '#4ba3d4';
    ctx.fill();
}
