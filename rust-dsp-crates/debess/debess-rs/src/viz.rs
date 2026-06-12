use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, Ordering, fence};

use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

// 频谱显示的对数频率 bin 数量（喂给 UI 的数据量）
pub const SPECTRUM_BINS: usize = 128;
// 分析 FFT 大小
const FFT_SIZE: usize = 2048;
// 每多少样本触发一次 FFT（hop）
const HOP: usize = 1024;

const F_MIN: f64 = 20.0;
const F_MAX: f64 = 20000.0;
const DB_FLOOR: f32 = -90.0;

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
    // 输入/输出环形缓冲，长度 FFT_SIZE
    in_buf: Vec<f32>,
    out_buf: Vec<f32>,
    write_pos: usize,
    samples_since_fft: usize,
    // FFT 工作内存
    scratch_in: Vec<f32>,
    spectrum: Vec<realfft::num_complex::Complex<f32>>,
    // 当前帧（音频线程维护，发布到 snapshot）
    frame: VizFrame,
    snapshot: VizSnapshot,
    // 每个 bin 对应的 FFT bin 索引（对数映射，预计算）
    bin_index: Vec<usize>,
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
            out_buf: vec![0.0; FFT_SIZE],
            write_pos: 0,
            samples_since_fft: 0,
            scratch_in,
            spectrum,
            frame: VizFrame::silent(),
            snapshot: VizSnapshot::new(),
            bin_index: vec![0; SPECTRUM_BINS],
        };
        analyzer.recompute_bin_index();
        analyzer
    }

    pub fn set_sample_rate(&mut self, sample_rate: i32) {
        self.sample_rate = sample_rate as f64;
        self.recompute_bin_index();
        self.reset();
    }

    pub fn reset(&mut self) {
        self.in_buf.iter_mut().for_each(|x| *x = 0.0);
        self.out_buf.iter_mut().for_each(|x| *x = 0.0);
        self.write_pos = 0;
        self.samples_since_fft = 0;
        self.frame = VizFrame::silent();
        self.snapshot.write(&self.frame);
    }

    pub fn snapshot(&self) -> &VizSnapshot {
        &self.snapshot
    }

    // 把对数频率 bin 映射到 FFT bin 索引
    fn recompute_bin_index(&mut self) {
        let nyquist = self.sample_rate * 0.5;
        let f_max = F_MAX.min(nyquist);
        let bin_hz = self.sample_rate / FFT_SIZE as f64;
        for b in 0..SPECTRUM_BINS {
            let t = b as f64 / (SPECTRUM_BINS - 1) as f64;
            let freq = F_MIN * (f_max / F_MIN).powf(t);
            let mut idx = (freq / bin_hz).round() as usize;
            if idx < 1 {
                idx = 1;
            }
            if idx >= FFT_SIZE / 2 {
                idx = FFT_SIZE / 2 - 1;
            }
            self.bin_index[b] = idx;
        }
    }

    // 音频线程每个 block 调用：传入本 block 的输入/输出（单声道分析信号）
    pub fn feed(&mut self, input: &[f32], output: &[f32]) {
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
            self.out_buf[self.write_pos] = xo;
            self.write_pos = (self.write_pos + 1) % FFT_SIZE;
            self.samples_since_fft += 1;
            if self.samples_since_fft >= HOP {
                self.samples_since_fft = 0;
                self.compute_fft();
            }
        }

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

    fn compute_fft(&mut self) {
        // 从环形缓冲按时间顺序取 FFT_SIZE 个样本并加窗，分别处理输入/输出
        self.fill_spectrum_for(true);
        self.fill_spectrum_for(false);
    }

    fn fill_spectrum_for(&mut self, is_input: bool) {
        for i in 0..FFT_SIZE {
            let pos = (self.write_pos + i) % FFT_SIZE;
            let sample = if is_input {
                self.in_buf[pos]
            } else {
                self.out_buf[pos]
            };
            self.scratch_in[i] = sample * self.window[i];
        }
        self.fft
            .process(&mut self.scratch_in, &mut self.spectrum)
            .unwrap();

        let norm = 2.0 / FFT_SIZE as f32;
        for b in 0..SPECTRUM_BINS {
            let idx = self.bin_index[b];
            let c = self.spectrum[idx];
            let mag = (c.re * c.re + c.im * c.im).sqrt() * norm;
            let db = if mag > 1e-9 {
                20.0 * mag.log10()
            } else {
                DB_FLOOR
            };
            let db = db.max(DB_FLOOR);
            if is_input {
                self.frame.input_db[b] = db;
            } else {
                self.frame.output_db[b] = db;
            }
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
