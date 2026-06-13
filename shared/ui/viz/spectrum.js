// 可复用频谱分析仪组件
//
// 纯渲染器：外部通过 setSeries(key, dbArray) 喂入各路 dB 数组，
// 组件按对数频率轴 + dB 轴渲染网格与曲线。
// 所有时域平滑在 Rust 侧完成，JS 不做任何弹道处理。

const DPR = window.devicePixelRatio || 1;

export class SpectrumAnalyzer {
    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.fMin = opts.fMin ?? 20;
        this.fMax = opts.fMax ?? 20000;
        this.dbMin = opts.dbMin ?? -90;
        this.dbMax = opts.dbMax ?? 6;
        this.binCount = opts.binCount ?? 192;
        this.padTop = opts.padTop ?? 0.06;
        this.padBottom = opts.padBottom ?? 0.13;

        this.gridColor = opts.gridColor ?? 'rgba(70,110,135,0.10)';
        this.gridColorMajor = opts.gridColorMajor ?? 'rgba(90,150,180,0.22)';
        this.labelColor = opts.labelColor ?? 'rgba(120,170,200,0.55)';
        this.font = opts.font ?? '500 9px Rajdhani, sans-serif';

        this.freqLines = opts.freqLines ?? [
            20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500, 600, 800,
            1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 20000,
        ];
        this.freqLabels = opts.freqLabels ?? {
            20: '20', 100: '100', 1000: '1k', 10000: '10k', 20000: '20k',
        };
        this.dbStep = opts.dbStep ?? 12;

        // series 定义：{ key, color, lineWidth, fill(bool), fillColor/fillTopColor/fillBottomColor }
        this.series = opts.series ?? [];
        // 差异填充：{ from, to, color }
        this.diffFill = opts.diffFill ?? null;

        this.data = new Map();
        for (const s of this.series) {
            this.data.set(s.key, new Float32Array(this.binCount).fill(this.dbMin));
        }

        this._running = false;
        this._raf = null;
        this._render = this._render.bind(this);
    }

    setSeries(key, dbArray) {
        if (!this.data.has(key)) {
            this.data.set(key, new Float32Array(this.binCount).fill(this.dbMin));
        }
        const dst = this.data.get(key);
        const n = Math.min(dbArray.length, this.binCount);
        for (let i = 0; i < n; i++) dst[i] = dbArray[i];
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._raf = requestAnimationFrame(this._render);
    }

    stop() {
        this._running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    _freqToX(hz, w) {
        const lmin = Math.log10(this.fMin);
        const lmax = Math.log10(this.fMax);
        return ((Math.log10(hz) - lmin) / (lmax - lmin)) * w;
    }

    _binToX(i, w) {
        return (i / (this.binCount - 1)) * w;
    }

    _dbToY(db, h) {
        const top = h * this.padTop;
        const usable = h * (1 - this.padTop - this.padBottom);
        const t = (db - this.dbMax) / (this.dbMin - this.dbMax);
        return top + Math.max(0, Math.min(1, t)) * usable;
    }

    _resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        if (this.canvas.width !== w * DPR || this.canvas.height !== h * DPR) {
            this.canvas.width = w * DPR;
            this.canvas.height = h * DPR;
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
        }
        return { w, h };
    }

    // 贝塞尔曲线（不含起点 moveTo），供 fill 路径使用
    _curveThrough(ctx, arr, w, h) {
        const n = this.binCount;
        for (let i = 1; i < n - 1; i++) {
            const x = this._binToX(i, w);
            const y = this._dbToY(arr[i], h);
            const nx = this._binToX(i + 1, w);
            const ny = this._dbToY(arr[i + 1], h);
            ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
        }
        ctx.lineTo(this._binToX(n - 1, w), this._dbToY(arr[n - 1], h));
    }

    // 含 moveTo 的完整路径，用于 stroke
    _tracePath(ctx, arr, w, h) {
        ctx.moveTo(this._binToX(0, w), this._dbToY(arr[0], h));
        this._curveThrough(ctx, arr, w, h);
    }

    _render() {
        if (!this._running) return;

        const { w, h } = this._resize();
        const ctx = this.ctx;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.clearRect(0, 0, w, h);

        this._drawGrid(w, h);

        // 差异填充（如 reduction 区域）
        if (this.diffFill) {
            const a = this.data.get(this.diffFill.from);
            const b = this.data.get(this.diffFill.to);
            if (a && b) {
                ctx.beginPath();
                ctx.moveTo(this._binToX(0, w), this._dbToY(a[0], h));
                this._curveThrough(ctx, a, w, h);
                for (let i = this.binCount - 1; i >= 0; i--) {
                    ctx.lineTo(this._binToX(i, w), this._dbToY(b[i], h));
                }
                ctx.closePath();
                ctx.fillStyle = this.diffFill.color;
                ctx.fill();
            }
        }

        // 各路 series
        const floorY = this._dbToY(this.dbMin, h);
        for (const s of this.series) {
            const arr = this.data.get(s.key);
            if (!arr) continue;

            if (s.fill) {
                ctx.beginPath();
                ctx.moveTo(this._binToX(0, w), floorY);
                ctx.lineTo(this._binToX(0, w), this._dbToY(arr[0], h));
                this._curveThrough(ctx, arr, w, h);
                ctx.lineTo(this._binToX(this.binCount - 1, w), floorY);
                ctx.closePath();
                if (s.fillTopColor && s.fillBottomColor) {
                    const g = ctx.createLinearGradient(0, h * this.padTop, 0, floorY);
                    g.addColorStop(0, s.fillTopColor);
                    g.addColorStop(1, s.fillBottomColor);
                    ctx.fillStyle = g;
                } else {
                    ctx.fillStyle = s.fillColor ?? s.color;
                }
                ctx.fill();
            }

            ctx.beginPath();
            this._tracePath(ctx, arr, w, h);
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.lineWidth ?? 1.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        this._raf = requestAnimationFrame(this._render);
    }

    _drawGrid(w, h) {
        const ctx = this.ctx;
        ctx.font = this.font;
        ctx.lineWidth = 1;

        for (const f of this.freqLines) {
            if (f < this.fMin || f > this.fMax) continue;
            const x = this._freqToX(f, w);
            const label = this.freqLabels[f];
            ctx.strokeStyle = label ? this.gridColorMajor : this.gridColor;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h - h * this.padBottom * 0.55);
            ctx.stroke();
            if (label) {
                ctx.fillStyle = this.labelColor;
                ctx.textAlign = 'center';
                ctx.fillText(label, x, h - 3);
            }
        }

        ctx.textAlign = 'left';
        for (let db = this.dbMax; db >= this.dbMin; db -= this.dbStep) {
            const y = this._dbToY(db, h);
            ctx.strokeStyle = db === 0 ? this.gridColorMajor : this.gridColor;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.fillStyle = this.labelColor;
            ctx.fillText((db > 0 ? '+' : '') + db, 3, y - 2);
        }
    }
}
