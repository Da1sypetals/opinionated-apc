// 可复用频谱分析仪组件
//
// 与任意插件无关：构造时传入 canvas 与配置，外部通过 setSeries(key, dbArray)
// 持续喂入各路 dB 数组，组件按对数频率轴 + dB 轴渲染网格与曲线。
//
// 显示质感（参考 FabFilter Pro-Q 等商业分析仪）：
//   - 对数频率轴 + 后端恒定 Q 式 bin 能量聚合（数据侧已做）
//   - 频谱倾斜补偿（数据侧已做）使曲线自然填满画面
//   - 时域弹道：快起慢落（peak-with-decay），消除逐帧抖动
//   - 平滑曲线（二次贝塞尔中点插值）+ 垂直渐变填充 + 高亮顶线
//   - 十倍频程网格 + 频率/dB 标注
//
// 数据约定：每路 series 是一个长度为 binCount 的 dB 数组。
// bin 在对数频率轴上等距分布（与后端的对数 bin 映射一致）。

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

        // 时域弹道：瞬时起、按 dB/秒 缓慢回落
        this.releaseDbPerSec = opts.releaseDbPerSec ?? 24;

        // 频率网格线（Hz）。主刻度带标签
        this.freqLines = opts.freqLines ?? [
            20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500, 600, 800,
            1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 20000,
        ];
        this.freqLabels = opts.freqLabels ?? {
            20: '20', 100: '100', 1000: '1k', 10000: '10k', 20000: '20k',
        };
        // dB 横线步长
        this.dbStep = opts.dbStep ?? 12;

        // series 定义：{ key, color, lineWidth, fill(bool), fillColor/fillTopColor/fillBottomColor }
        this.series = opts.series ?? [];
        // 差异填充：{ from, to, color } 在两路 series 之间填充
        this.diffFill = opts.diffFill ?? null;

        this.data = new Map(); // key -> 目标 dB（来自后端）
        this.disp = new Map(); // key -> 显示 dB（弹道平滑后）
        for (const s of this.series) {
            this.data.set(s.key, new Float32Array(this.binCount).fill(this.dbMin));
            this.disp.set(s.key, new Float32Array(this.binCount).fill(this.dbMin));
        }

        this._running = false;
        this._raf = null;
        this._lastT = 0;
        this._render = this._render.bind(this);
    }

    setSeries(key, dbArray) {
        if (!this.data.has(key)) {
            this.data.set(key, new Float32Array(this.binCount).fill(this.dbMin));
            this.disp.set(key, new Float32Array(this.binCount).fill(this.dbMin));
        }
        const dst = this.data.get(key);
        const n = Math.min(dbArray.length, this.binCount);
        for (let i = 0; i < n; i++) dst[i] = dbArray[i];
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._lastT = performance.now();
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

    // 弹道：瞬时起、缓慢落
    _advance(dt) {
        const fall = this.releaseDbPerSec * dt;
        for (const s of this.series) {
            const target = this.data.get(s.key);
            const cur = this.disp.get(s.key);
            for (let i = 0; i < this.binCount; i++) {
                const t = target[i];
                if (t >= cur[i]) cur[i] = t;
                else cur[i] = Math.max(t, cur[i] - fall);
            }
        }
    }

    // 用二次贝塞尔中点插值生成平滑路径（不含 begin/close）
    _tracePath(ctx, arr, w, h) {
        const n = this.binCount;
        let px = this._binToX(0, w);
        let py = this._dbToY(arr[0], h);
        ctx.moveTo(px, py);
        for (let i = 1; i < n - 1; i++) {
            const x = this._binToX(i, w);
            const y = this._dbToY(arr[i], h);
            const nx = this._binToX(i + 1, w);
            const ny = this._dbToY(arr[i + 1], h);
            const xc = (x + nx) / 2;
            const yc = (y + ny) / 2;
            ctx.quadraticCurveTo(x, y, xc, yc);
        }
        ctx.lineTo(this._binToX(n - 1, w), this._dbToY(arr[n - 1], h));
    }

    _render(now) {
        if (!this._running) return;
        const dt = Math.min(0.1, (now - this._lastT) / 1000 || 0);
        this._lastT = now;
        this._advance(dt);

        const { w, h } = this._resize();
        const ctx = this.ctx;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.clearRect(0, 0, w, h);

        this._drawGrid(w, h);

        // 差异填充（如 reduction 区域）：input 与 output 之间
        if (this.diffFill) {
            const a = this.disp.get(this.diffFill.from);
            const b = this.disp.get(this.diffFill.to);
            if (a && b) {
                ctx.beginPath();
                this._tracePath(ctx, a, w, h);
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
            const arr = this.disp.get(s.key);
            if (!arr) continue;

            if (s.fill) {
                ctx.beginPath();
                ctx.moveTo(this._binToX(0, w), floorY);
                ctx.lineTo(this._binToX(0, w), this._dbToY(arr[0], h));
                this._tracePath(ctx, arr, w, h);
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

        // 频率竖线
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

        // dB 横线
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
