// 可复用竖向电平条组件
//
// 与任意插件无关：包装一个填充元素，set(value 0..1) 更新高度，带峰值保持下降。
// 用 CSS 控制配色（fill 元素的 background）。

export class Meter {
    constructor(fillEl, opts = {}) {
        this.fillEl = fillEl;
        this.smooth = opts.smooth ?? 0.5;     // 平滑系数（上升快、下降慢可分开设）
        this.decay = opts.decay ?? 0.05;       // 每帧峰值下降量
        this.current = 0;
        this.peak = 0;
    }

    set(value) {
        const v = Math.max(0, Math.min(1, value));
        // 上升即时跟随，下降平滑
        if (v > this.current) this.current = v;
        else this.current = this.current * this.smooth + v * (1 - this.smooth);

        if (this.current > this.peak) this.peak = this.current;
        else this.peak = Math.max(this.current, this.peak - this.decay);

        this.fillEl.style.height = (this.current * 100) + '%';
    }

    reset() {
        this.current = 0;
        this.peak = 0;
        this.fillEl.style.height = '0%';
    }
}
