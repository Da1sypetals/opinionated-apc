// 可复用增益衰减(GR)时间线组件
//
// 与任意插件无关：组件自己维护滚动历史 ring buffer（历史是纯 UI 关注点）。
// 外部每帧调用 push(gr, level)：
//   - gr: 当前增益衰减量（dB，>=0 表示衰减）
//   - level: 当前信号电平（0..1），用于画底层波形包络
// 组件从右往左滚动渲染 GR 曲线（自顶向下）+ 波形包络。

const DPR = window.devicePixelRatio || 1;

export class GrTimeline {
    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.historyLen = opts.historyLen ?? 400;
        this.grMaxDb = opts.grMaxDb ?? 24; // 纵轴底部对应的衰减量
        this.padTop = opts.padTop ?? 10;
        this.padBottom = opts.padBottom ?? 18;
        this.padLeft = opts.padLeft ?? 34;
        this.padRight = opts.padRight ?? 8;

        this.grColor = opts.grColor ?? '#e8445a';
        this.grFillTop = opts.grFillTop ?? 'rgba(232,68,90,0.04)';
        this.grFillBottom = opts.grFillBottom ?? 'rgba(232,68,90,0.28)';
        this.waveColor = opts.waveColor ?? 'rgba(70,120,150,0.12)';
        this.gridColor = opts.gridColor ?? 'rgba(50,80,100,0.12)';
        this.zeroLineColor = opts.zeroLineColor ?? 'rgba(90,200,224,0.2)';
        this.labelColor = opts.labelColor ?? '#2a4050';
        this.font = opts.font ?? '500 8px Rajdhani, sans-serif';

        this.timeLabels = opts.timeLabels ?? ['8s', '6s', '4s', '2s', 'NOW'];
        this.dbLabels = opts.dbLabels ?? ['0', '-6', '-12', '-18', '-24'];

        this.grHistory = new Float32Array(this.historyLen);
        this.waveHistory = new Float32Array(this.historyLen);

        this._running = false;
        this._raf = null;
        this._render = this._render.bind(this);
    }

    push(gr, level) {
        this.grHistory.copyWithin(0, 1);
        this.grHistory[this.historyLen - 1] = gr;
        this.waveHistory.copyWithin(0, 1);
        this.waveHistory[this.historyLen - 1] = level;
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

        const plotW = w - this.padLeft - this.padRight;
        const plotH = h - this.padTop - this.padBottom;
        const n = this.historyLen;

        // 网格
        ctx.strokeStyle = this.gridColor;
        ctx.lineWidth = 1;
        ctx.font = this.font;
        ctx.fillStyle = this.labelColor;
        for (let i = 0; i <= 4; i++) {
            const y = this.padTop + plotH * (i / 4);
            ctx.beginPath();
            ctx.moveTo(this.padLeft, y);
            ctx.lineTo(w - this.padRight, y);
            ctx.stroke();
        }
        ctx.textAlign = 'center';
        for (let i = 0; i < this.timeLabels.length; i++) {
            const x = this.padLeft + plotW * (i / (this.timeLabels.length - 1));
            ctx.fillText(this.timeLabels[i], x, h - 4);
        }
        ctx.textAlign = 'right';
        for (let i = 0; i < this.dbLabels.length; i++) {
            const y = this.padTop + plotH * (i / (this.dbLabels.length - 1));
            ctx.fillText(this.dbLabels[i], this.padLeft - 4, y + 3);
        }

        // 波形包络（底层填充）
        ctx.beginPath();
        const midY = this.padTop + plotH;
        ctx.moveTo(this.padLeft, midY);
        for (let i = 0; i < n; i++) {
            const x = this.padLeft + (i / (n - 1)) * plotW;
            const env = Math.max(0, Math.min(1, this.waveHistory[i]));
            const y = midY - env * plotH;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w - this.padRight, midY);
        ctx.closePath();
        ctx.fillStyle = this.waveColor;
        ctx.fill();

        // GR 填充（自顶向下）
        const grY = (gr) => this.padTop + Math.max(0, Math.min(1, gr / this.grMaxDb)) * plotH;
        ctx.beginPath();
        ctx.moveTo(this.padLeft, this.padTop);
        for (let i = 0; i < n; i++) {
            const x = this.padLeft + (i / (n - 1)) * plotW;
            ctx.lineTo(x, grY(this.grHistory[i]));
        }
        ctx.lineTo(w - this.padRight, this.padTop);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, this.padTop, 0, this.padTop + plotH * 0.6);
        grad.addColorStop(0, this.grFillTop);
        grad.addColorStop(1, this.grFillBottom);
        ctx.fillStyle = grad;
        ctx.fill();

        // GR 曲线
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = this.padLeft + (i / (n - 1)) * plotW;
            const y = grY(this.grHistory[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = this.grColor;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // 0dB 零线
        ctx.beginPath();
        ctx.moveTo(this.padLeft, this.padTop);
        ctx.lineTo(w - this.padRight, this.padTop);
        ctx.strokeStyle = this.zeroLineColor;
        ctx.lineWidth = 1;
        ctx.stroke();

        this._raf = requestAnimationFrame(this._render);
    }
}
