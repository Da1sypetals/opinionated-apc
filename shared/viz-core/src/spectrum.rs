use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

pub struct SpectrumConfig {
    pub fft_size: usize,
    pub hop: usize,
    pub bin_count: usize,
    pub f_min: f64,
    pub f_max: f64,
    pub tilt_db_per_oct: f32,
    pub tilt_pivot_hz: f64,
    pub db_floor: f32,
    pub attack_ms: f32,
    pub release_ms: f32,
}

impl Default for SpectrumConfig {
    fn default() -> Self {
        Self {
            fft_size: 4096,
            hop: 512,
            bin_count: 192,
            f_min: 20.0,
            f_max: 20000.0,
            tilt_db_per_oct: 4.5,
            tilt_pivot_hz: 1000.0,
            db_floor: -96.0,
            attack_ms: 0.0,
            release_ms: 300.0,
        }
    }
}

pub struct SpectrumEngine {
    sample_rate: f64,
    fft_size: usize,
    hop: usize,
    db_floor: f32,
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    ring_buf: Vec<f32>,
    write_pos: usize,
    samples_since_fft: usize,
    scratch_in: Vec<f32>,
    spectrum: Vec<realfft::num_complex::Complex<f32>>,
    band_lo: Vec<usize>,
    band_hi: Vec<usize>,
    band_center: Vec<f64>,
    band_tilt: Vec<f32>,
    // 平滑后的最终 dB 输出
    bins: Vec<f32>,
    // 线性功率域 EMA 状态
    smooth_power: Vec<f32>,
    attack_coeff: f32,
    release_coeff: f32,
    f_min: f64,
    f_max: f64,
    tilt_db_per_oct: f32,
    tilt_pivot_hz: f64,
    attack_ms: f32,
    release_ms: f32,
}

impl SpectrumEngine {
    pub fn new(sample_rate: i32, config: SpectrumConfig) -> Self {
        let fft_size = config.fft_size;
        let bin_count = config.bin_count;

        let mut planner = RealFftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(fft_size);
        let scratch_in = fft.make_input_vec();
        let spectrum = fft.make_output_vec();

        // Hann 窗
        let window: Vec<f32> = (0..fft_size)
            .map(|n| {
                let w = 0.5
                    - 0.5
                        * (2.0 * std::f64::consts::PI * n as f64 / fft_size as f64).cos();
                w as f32
            })
            .collect();

        // 按 FFT 帧率计算 EMA 系数
        let frame_rate = sample_rate as f64 / config.hop as f64;
        let attack_coeff = ms_to_coeff(config.attack_ms, frame_rate);
        let release_coeff = ms_to_coeff(config.release_ms, frame_rate);

        let mut engine = Self {
            sample_rate: sample_rate as f64,
            fft_size,
            hop: config.hop,
            db_floor: config.db_floor,
            fft,
            window,
            ring_buf: vec![0.0; fft_size],
            write_pos: 0,
            samples_since_fft: 0,
            scratch_in,
            spectrum,
            band_lo: vec![0; bin_count],
            band_hi: vec![0; bin_count],
            band_center: vec![0.0; bin_count],
            band_tilt: vec![0.0; bin_count],
            bins: vec![config.db_floor; bin_count],
            smooth_power: vec![0.0; bin_count],
            attack_coeff,
            release_coeff,
            f_min: config.f_min,
            f_max: config.f_max,
            tilt_db_per_oct: config.tilt_db_per_oct,
            tilt_pivot_hz: config.tilt_pivot_hz,
            attack_ms: config.attack_ms,
            release_ms: config.release_ms,
        };
        engine.recompute_bands();
        engine
    }

    pub fn set_sample_rate(&mut self, sample_rate: i32) {
        self.sample_rate = sample_rate as f64;
        let frame_rate = self.sample_rate / self.hop as f64;
        self.attack_coeff = ms_to_coeff(self.attack_ms, frame_rate);
        self.release_coeff = ms_to_coeff(self.release_ms, frame_rate);
        self.recompute_bands();
        self.reset();
    }

    pub fn reset(&mut self) {
        self.ring_buf.iter_mut().for_each(|x| *x = 0.0);
        self.write_pos = 0;
        self.samples_since_fft = 0;
        self.smooth_power.iter_mut().for_each(|x| *x = 0.0);
        self.bins.iter_mut().for_each(|x| *x = self.db_floor);
    }

    pub fn bin_count(&self) -> usize {
        self.bins.len()
    }

    pub fn smoothed_bins(&self) -> &[f32] {
        &self.bins
    }

    pub fn band_centers(&self) -> &[f64] {
        &self.band_center
    }

    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    pub fn db_floor(&self) -> f32 {
        self.db_floor
    }

    pub fn feed(&mut self, samples: &[f32]) {
        for &s in samples {
            self.ring_buf[self.write_pos] = s;
            self.write_pos = (self.write_pos + 1) % self.fft_size;
            self.samples_since_fft += 1;
            if self.samples_since_fft >= self.hop {
                self.samples_since_fft = 0;
                self.compute_spectrum();
            }
        }
    }

    // DAW 暂停后由 C++ timer (~30Hz) 调用。
    // release_coeff 是按 FFT 帧率算的，这里要补偿帧率差。
    pub fn decay_to_silence(&mut self) {
        let frame_rate = self.sample_rate / self.hop as f64;
        let steps = (frame_rate / 30.0).ceil() as i32;
        let coeff = self.release_coeff.powi(steps);
        let n = self.smooth_power.len();
        for b in 0..n {
            self.smooth_power[b] *= coeff;
        }
        self.power_to_db();
    }

    fn recompute_bands(&mut self) {
        let nyquist = self.sample_rate * 0.5;
        let f_max = self.f_max.min(nyquist);
        let bin_hz = self.sample_rate / self.fft_size as f64;
        let n = self.bins.len();
        let last = (n - 1) as f64;
        let ratio = (f_max / self.f_min).powf(1.0 / last);
        let half_step = ratio.sqrt();
        let max_idx = self.fft_size / 2;

        for b in 0..n {
            let t = b as f64 / last;
            let f_center = self.f_min * (f_max / self.f_min).powf(t);
            let f_lo = f_center / half_step;
            let f_hi = f_center * half_step;

            let mut lo = (f_lo / bin_hz).floor() as i64;
            let mut hi = (f_hi / bin_hz).ceil() as i64;
            if lo < 1 { lo = 1; }
            if hi <= lo { hi = lo + 1; }
            if hi > max_idx as i64 { hi = max_idx as i64; }
            if lo >= hi { lo = hi - 1; }
            self.band_lo[b] = lo as usize;
            self.band_hi[b] = hi as usize;
            self.band_center[b] = f_center;

            let octaves = (f_center / self.tilt_pivot_hz).log2() as f32;
            self.band_tilt[b] = self.tilt_db_per_oct * octaves;
        }
    }

    fn compute_spectrum(&mut self) {
        // 加窗 + FFT
        for i in 0..self.fft_size {
            let pos = (self.write_pos + i) % self.fft_size;
            self.scratch_in[i] = self.ring_buf[pos] * self.window[i];
        }
        self.fft
            .process(&mut self.scratch_in, &mut self.spectrum)
            .unwrap();

        let n = self.bins.len();

        // 逐 band 聚合 → 线性功率域 EMA → dB
        for b in 0..n {
            let lo = self.band_lo[b];
            let hi = self.band_hi[b];
            let mut power_sum = 0.0f32;
            for idx in lo..hi {
                let c = self.spectrum[idx];
                power_sum += c.re * c.re + c.im * c.im;
            }
            let count = (hi - lo).max(1) as f32;
            let raw_power = power_sum / count;

            // 非对称 EMA：instant attack + slow release
            let prev = self.smooth_power[b];
            let coeff = if raw_power >= prev {
                self.attack_coeff
            } else {
                self.release_coeff
            };
            self.smooth_power[b] = prev * coeff + raw_power * (1.0 - coeff);
        }

        self.power_to_db();
    }

    // 把 smooth_power 转成 dB + tilt，写入 self.bins
    fn power_to_db(&mut self) {
        let amp_norm = 2.0 / self.fft_size as f32;
        let cal = 20.0 * amp_norm.log10();
        let n = self.bins.len();

        for b in 0..n {
            let p = self.smooth_power[b];
            let db = if p > 1e-20 {
                10.0 * p.log10() + cal + self.band_tilt[b]
            } else {
                self.db_floor
            };
            self.bins[b] = db.max(self.db_floor);
        }
    }
}

// 毫秒时间常数 → EMA 系数 alpha = exp(-1 / (tau * frame_rate))
// alpha 越大衰减越慢。ms=0 → alpha=0（instant）
fn ms_to_coeff(ms: f32, frame_rate: f64) -> f32 {
    if ms <= 0.0 {
        return 0.0;
    }
    let tau = ms as f64 / 1000.0;
    (-1.0 / (tau * frame_rate)).exp() as f32
}
