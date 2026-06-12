use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, Ordering, fence};

use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

// 频谱显示的对数频率 bin 数量（喂给 UI 的数据量）
pub const SPECTRUM_BINS: usize = 192;
// 分析 FFT 大小
const FFT_SIZE: usize = 4096;
// 每多少样本触发一次 FFT（hop）
const HOP: usize = 512;

const F_MIN: f64 = 20.0;
const F_MAX: f64 = 20000.0;
const DB_FLOOR: f32 = -96.0;

// 频谱倾斜：绕 1 kHz 以指定斜率抬高高频/压低低频，使典型音乐/粉噪看起来自然填满画面
// （与 FabFilter Pro-Q 默认 4.5 dB/oct 一致）
const TILT_DB_PER_OCT: f32 = 4.5;
const TILT_PIVOT_HZ: f64 = 1000.0;

// UI 一帧可视化数据，布局为 #[repr(C)] 以便快照按值拷贝
#[derive(Clone, Copy)]
pub struct VizFrame {
    pub input_db: [f32; SPECTRUM_BINS],
    pub output_db: [f32; SPECTRUM_BINS],
    pub gr_db: f32,
    pub input_level: f32,
    pub output_level: f32,
}

impl VizFrame {
    fn silent() -> Self {
        Self {
            input_db: [DB_FLOOR; SPECTRUM_BINS],
            output_db: [DB_FLOOR; SPECTRUM_BINS],
            gr_db: 0.0,
            input_level: 0.0,
            output_level: 0.0,
        }
    }
}

// 单写者(音频线程) + 单读者(UI线程) 的 SeqLock 快照
pub struct VizSnapshot {
    seq: AtomicU32,
    data: UnsafeCell<VizFrame>,
}

unsafe impl Sync for VizSnapshot {}

impl VizSnapshot {
    fn new() -> Self {
        Self {
            seq: AtomicU32::new(0),
            data: UnsafeCell::new(VizFrame::silent()),
        }
    }

    // 仅音频线程调用
    fn write(&self, frame: &VizFrame) {
        let s = self.seq.load(Ordering::Relaxed);
        self.seq.store(s.wrapping_add(1), Ordering::Release); // 奇数 = 写入中
        fence(Ordering::Release);
        unsafe {
            *self.data.get() = *frame;
        }
        self.seq.store(s.wrapping_add(2), Ordering::Release); // 偶数 = 写入完成
    }

    // 仅 UI 线程调用
    pub fn read(&self) -> VizFrame {
        loop {
            let s1 = self.seq.load(Ordering::Acquire);
            if s1 & 1 != 0 {
                std::hint::spin_loop();
                continue;
            }
            let frame = unsafe { *self.data.get() };
            fence(Ordering::Acquire);
            let s2 = self.seq.load(Ordering::Acquire);
            if s1 == s2 {
                return frame;
            }
        }
    }
}

pub struct VizAnalyzer {
    sample_rate: f64,
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    // 输入环形缓冲，长度 FFT_SIZE（output 频谱由 input + 滤波器频响推导，无需单独缓冲）
    in_buf: Vec<f32>,
    write_pos: usize,
    samples_since_fft: usize,
    // FFT 工作内存
    scratch_in: Vec<f32>,
    spectrum: Vec<realfft::num_complex::Complex<f32>>,
    // 当前帧（音频线程维护，发布到 snapshot）
    frame: VizFrame,
    snapshot: VizSnapshot,
    // 每个显示频段聚合的 FFT bin 区间 [lo, hi)（对数映射，预计算）
    band_lo: Vec<usize>,
    band_hi: Vec<usize>,
    // 每个显示频段的中心频率（Hz，预计算，用于推导去齿音滤波器频响）
    band_center: Vec<f64>,
    // 每个显示频段的倾斜补偿量（dB，预计算）
    band_tilt: Vec<f32>,
}

impl VizAnalyzer {
    pub fn new(sample_rate: i32) -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        let scratch_in = fft.make_input_vec();
        let spectrum = fft.make_output_vec();

        // Hann 窗
        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|n| {
                let w = 0.5
                    - 0.5
                        * (2.0 * std::f64::consts::PI * n as f64 / FFT_SIZE as f64).cos();
                w as f32
            })
            .collect();

        let mut analyzer = Self {
            sample_rate: sample_rate as f64,
            fft,
            window,
            in_buf: vec![0.0; FFT_SIZE],
            write_pos: 0,
            samples_since_fft: 0,
            scratch_in,
            spectrum,
            frame: VizFrame::silent(),
            snapshot: VizSnapshot::new(),
            band_lo: vec![0; SPECTRUM_BINS],
            band_hi: vec![0; SPECTRUM_BINS],
            band_center: vec![0.0; SPECTRUM_BINS],
            band_tilt: vec![0.0; SPECTRUM_BINS],
        };
        analyzer.recompute_bands();
        analyzer
    }

    pub fn set_sample_rate(&mut self, sample_rate: i32) {
        self.sample_rate = sample_rate as f64;
        self.recompute_bands();
        self.reset();
    }

    pub fn reset(&mut self) {
        self.in_buf.iter_mut().for_each(|x| *x = 0.0);
        self.write_pos = 0;
        self.samples_since_fft = 0;
        self.frame = VizFrame::silent();
        self.snapshot.write(&self.frame);
    }

    pub fn snapshot(&self) -> &VizSnapshot {
        &self.snapshot
    }

    // 为每个对数频率显示频段预计算：聚合的 FFT bin 区间 [lo, hi) 以及倾斜补偿
    fn recompute_bands(&mut self) {
        let nyquist = self.sample_rate * 0.5;
        let f_max = F_MAX.min(nyquist);
        let bin_hz = self.sample_rate / FFT_SIZE as f64;
        let last = (SPECTRUM_BINS - 1) as f64;
        // 相邻显示频段中心的频率比，用于取频段边界（对数中点）
        let ratio = (f_max / F_MIN).powf(1.0 / last);
        let half_step = ratio.sqrt();
        let max_idx = FFT_SIZE / 2;

        for b in 0..SPECTRUM_BINS {
            let t = b as f64 / last;
            let f_center = F_MIN * (f_max / F_MIN).powf(t);
            let f_lo = f_center / half_step;
            let f_hi = f_center * half_step;

            let mut lo = (f_lo / bin_hz).floor() as i64;
            let mut hi = (f_hi / bin_hz).ceil() as i64;
            if lo < 1 {
                lo = 1;
            }
            if hi <= lo {
                hi = lo + 1;
            }
            if hi > max_idx as i64 {
                hi = max_idx as i64;
            }
            if lo >= hi {
                lo = hi - 1;
            }
            self.band_lo[b] = lo as usize;
            self.band_hi[b] = hi as usize;
            self.band_center[b] = f_center;

            // 倾斜：绕 TILT_PIVOT_HZ，每倍频程 TILT_DB_PER_OCT
            let octaves = (f_center / TILT_PIVOT_HZ).log2() as f32;
            self.band_tilt[b] = TILT_DB_PER_OCT * octaves;
        }
    }

    // 音频线程每个 block 调用：传入本 block 的输入/输出（单声道分析信号），
    // 以及当前去齿音 ratio、低通系数（FILTER）与监听模式。
    // input 频谱实测；output 频谱由 input 频谱乘以去齿音滤波器的真实频响推导得到，
    // 因此 output 在每个频率上都 <= input（监听模式下为被移除的成分），两条曲线天然不交叉。
    pub fn feed(
        &mut self,
        input: &[f32],
        output: &[f32],
        ratio: f64,
        iir_amount: f64,
        monitoring: i32,
    ) {
        let n = input.len();

        // block 级 GR 与电平测量
        let mut in_sq = 0.0f64;
        let mut out_sq = 0.0f64;
        let mut in_peak = 0.0f32;
        let mut out_peak = 0.0f32;
        for i in 0..n {
            let xi = input[i];
            let xo = output[i];
            in_sq += (xi as f64) * (xi as f64);
            out_sq += (xo as f64) * (xo as f64);
            in_peak = in_peak.max(xi.abs());
            out_peak = out_peak.max(xo.abs());

            self.in_buf[self.write_pos] = xi;
            self.write_pos = (self.write_pos + 1) % FFT_SIZE;
            self.samples_since_fft += 1;
            if self.samples_since_fft >= HOP {
                self.samples_since_fft = 0;
                self.compute_input_spectrum();
            }
        }

        // 由 input 频谱 + 去齿音滤波器频响推导 output 频谱
        self.derive_output_spectrum(ratio, iir_amount, monitoring);

        if n > 0 {
            let in_rms = (in_sq / n as f64).sqrt();
            let out_rms = (out_sq / n as f64).sqrt();
            // GR：输入比输出响多少 dB（衰减量，>=0）
            let gr = if in_rms > 1e-9 && out_rms > 1e-9 {
                (20.0 * (in_rms / out_rms).log10()).max(0.0)
            } else {
                0.0
            };
            // 平滑，避免抖动
            let prev = self.frame.gr_db as f64;
            let smoothed = prev * 0.6 + gr * 0.4;
            self.frame.gr_db = smoothed as f32;
            self.frame.input_level = level_to_norm(in_peak);
            self.frame.output_level = level_to_norm(out_peak);
        }

        self.snapshot.write(&self.frame);
    }

    fn compute_input_spectrum(&mut self) {
        for i in 0..FFT_SIZE {
            let pos = (self.write_pos + i) % FFT_SIZE;
            self.scratch_in[i] = self.in_buf[pos] * self.window[i];
        }
        self.fft
            .process(&mut self.scratch_in, &mut self.spectrum)
            .unwrap();

        // 幅度归一化：单频满量程正弦 → 约 0 dB（与加窗补偿合并到 CAL）
        let amp_norm = 2.0 / FFT_SIZE as f32;
        // 功率域偏移：10log10(P) + CAL == 20log10(sqrt(P)*amp_norm)
        let cal = 20.0 * amp_norm.log10();

        for b in 0..SPECTRUM_BINS {
            let lo = self.band_lo[b];
            let hi = self.band_hi[b];
            // 聚合频段内所有 FFT bin 的功率（均值），既正确反映高频能量也消除挑单根 bin 的尖刺
            let mut power_sum = 0.0f32;
            for idx in lo..hi {
                let c = self.spectrum[idx];
                power_sum += c.re * c.re + c.im * c.im;
            }
            let count = (hi - lo).max(1) as f32;
            let mean_power = power_sum / count;
            let db = if mean_power > 1e-20 {
                10.0 * mean_power.log10() + cal + self.band_tilt[b]
            } else {
                DB_FLOOR
            };
            self.frame.input_db[b] = db.max(DB_FLOOR);
        }
    }

    // 由 input 频谱推导 output 频谱：output(f) = input(f) * |H(f)|
    // 去齿音逐样本处理为 out = iir + (in - iir)/ratio，iir 是 in 的一阶低通（系数 = iir_amount）。
    // 其传递函数 H(z) = LP(z)*(1 - 1/ratio) + 1/ratio，可证 |H(f)| <= 1 恒成立。
    // 监听模式下显示被移除成分，增益为 |1 - H(f)|。
    fn derive_output_spectrum(&mut self, ratio: f64, iir_amount: f64, monitoring: i32) {
        let a = iir_amount.clamp(0.0, 1.0);
        let inv_ratio = (1.0 / ratio.max(1.0)).clamp(0.0, 1.0);
        let one_minus_a = 1.0 - a;

        for b in 0..SPECTRUM_BINS {
            let omega = 2.0 * std::f64::consts::PI * self.band_center[b] / self.sample_rate;
            let cos_w = omega.cos();
            let sin_w = omega.sin();

            // LP(ω) = a / (1 - (1-a) e^{-jω})
            let denom_re = 1.0 - one_minus_a * cos_w;
            let denom_im = one_minus_a * sin_w;
            let denom_mag2 = denom_re * denom_re + denom_im * denom_im;
            let lp_re = a * denom_re / denom_mag2;
            let lp_im = -a * denom_im / denom_mag2;

            // H = LP*(1 - 1/ratio) + 1/ratio
            let h_re = lp_re * (1.0 - inv_ratio) + inv_ratio;
            let h_im = lp_im * (1.0 - inv_ratio);

            // 监听模式：被移除成分 = 1 - H
            let (g_re, g_im) = if monitoring == 1 {
                (1.0 - h_re, -h_im)
            } else {
                (h_re, h_im)
            };
            let gain = (g_re * g_re + g_im * g_im).sqrt().max(1e-6);
            let gain_db = (20.0 * gain.log10()) as f32;

            let out_db = self.frame.input_db[b] + gain_db;
            self.frame.output_db[b] = out_db.max(DB_FLOOR);
        }
    }
}

// 把峰值线性幅度映射到 0..1 的显示刻度（约 -60dB..0dB）
fn level_to_norm(peak: f32) -> f32 {
    if peak <= 1e-9 {
        return 0.0;
    }
    let db = 20.0 * peak.log10();
    ((db + 60.0) / 60.0).clamp(0.0, 1.0)
}
