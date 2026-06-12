// 可复用频谱分析仪组件
//
// 与任意插件无关：构造时传入 canvas 与配置，外部通过 setSeries(key, dbArray)
// 持续喂入各路 dB 数组，组件按对数频率轴 + dB 轴渲染网格与曲线。
// 可定义任意条 series（line 或 fill），并可声明一对 series 之间的差异填充
// （例如输入/输出之间的 reduction 区域）。
//
// 数据约定：每路 series 是一个长度为 binCount 的 dB 数组（如 -90..0）。
// bin 在对数频率轴上等距分布（与后端的对数 bin 映射一致）。

const DPR = window.devicePixelRatio || 1;

export class SpectrumAnalyzer {
    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.fMin = opts.fMin ?? 20;
        this.fMax = opts.fMax ?? 20000;
        this.dbMin = opts.dbMin ?? -72;
        this.dbMax = opts.dbMax ?? 6;
        this.binCount = opts.binCount ?? 128;
        this.padTop = opts.padTop ?? 0.08;
        this.padBottom = opts.padBottom ?? 0.12;

        this.gridColor = opts.gridColor ?? 'rgba(50,80,100,0.12)';
        this.labelColor = opts.labelColor ?? '#2a4050';
        this.font = opts.font ?? '500 8px Rajdhani, sans-serif';

        // 频率/分贝刻度
        this.freqTicks = opts.freqTicks ?? [100, 1000, 10000];
        this.freqTickLabels = opts.freqTickLabels ?? ['100', '1k', '10k'];
        this.dbTicks = opts.dbTicks ?? [0, -24, -48];

        // series 定义：{ key, color, lineWidth, fillTo(底部基线/'floor') }
        this.series = opts.series ?? [];
        // 差异填充：{ from, to, color } 在两路 series 之间填充
        this.diffFill = opts.diffFill ?? null;

        this.data = new Map(); // key -> Float32Array(dB)
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

    // 对数频率 → x 像素
    _freqToX(hz, w) {
        const lmin = Math.log10(this.fMin);
        const lmax = Math.log10(this.fMax);
        return ((Math.log10(hz) - lmin) / (lmax - lmin)) * w;
    }

    // bin 索引 → x 像素（bin 在对数频率轴上等距）
    _binToX(i, w) {
        return (i / (this.binCount - 1)) * w;
    }

    // dB → y 像素
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
                for (let i = 0; i < this.binCount; i++) {
                    const x = this._binToX(i, w);
                    const y = this._dbToY(a[i], h);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                for (let i = this.binCount - 1; i >= 0; i--) {
                    const x = this._binToX(i, w);
                    const y = this._dbToY(b[i], h);
                    ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.fillStyle = this.diffFill.color;
                ctx.fill();
            }
        }

        // 各路 series
        for (const s of this.series) {
            const arr = this.data.get(s.key);
            if (!arr) continue;

            if (s.fillTo !== undefined) {
                const baseY = s.fillTo === 'floor' ? this._dbToY(this.dbMin, h) : this._dbToY(s.fillTo, h);
                ctx.beginPath();
                ctx.moveTo(0, baseY);
                for (let i = 0; i < this.binCount; i++) {
                    ctx.lineTo(this._binToX(i, w), this._dbToY(arr[i], h));
                }
                ctx.lineTo(w, baseY);
                ctx.closePath();
                ctx.fillStyle = s.fillColor ?? s.color;
                ctx.fill();
            }

            ctx.beginPath();
            for (let i = 0; i < this.binCount; i++) {
                const x = this._binToX(i, w);
                const y = this._dbToY(arr[i], h);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.lineWidth ?? 1.5;
            ctx.lineJoin = 'round';
            ctx.stroke();
        }

        this._raf = requestAnimationFrame(this._render);
    }

    _drawGrid(w, h) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.gridColor;
        ctx.lineWidth = 1;
        ctx.font = this.font;
        ctx.fillStyle = this.labelColor;

        // 频率竖线
        for (let i = 0; i < this.freqTicks.length; i++) {
            const x = this._freqToX(this.freqTicks[i], w);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.fillText(this.freqTickLabels[i], x, h - 3);
        }

        // dB 横线
        ctx.textAlign = 'left';
        for (const db of this.dbTicks) {
            const y = this._dbToY(db, h);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.fillText(db + '', 3, y - 2);
        }
    }
}
