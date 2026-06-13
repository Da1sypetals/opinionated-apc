use viz_core::{SeqLock, SpectrumConfig, SpectrumEngine};
use viz_core::meter::{PeakMeter, level_to_norm};

pub const SPECTRUM_BINS: usize = 192;

const DB_FLOOR: f32 = -96.0;

#[derive(Clone, Copy)]
pub struct VizFrame {
    pub input_db: [f32; SPECTRUM_BINS],
    pub output_db: [f32; SPECTRUM_BINS],
    pub gr_db: f32,
    pub input_level: f32,
    pub output_level: f32,
    pub active: bool,
}

impl VizFrame {
    pub fn silent() -> Self {
        Self {
            input_db: [DB_FLOOR; SPECTRUM_BINS],
            output_db: [DB_FLOOR; SPECTRUM_BINS],
            gr_db: 0.0,
            input_level: 0.0,
            output_level: 0.0,
            active: false,
        }
    }
}

pub struct VizAnalyzer {
    engine: SpectrumEngine,
    frame: VizFrame,
    snapshot: SeqLock<VizFrame>,
    // 缓存 derive_output_spectrum 所需的参数
    last_ratio: f64,
    last_iir_amount: f64,
    last_monitoring: i32,
}

impl VizAnalyzer {
    pub fn new(sample_rate: i32) -> Self {
        let config = SpectrumConfig {
            fft_size: 4096,
            hop: 512,
            bin_count: SPECTRUM_BINS,
            f_min: 20.0,
            f_max: 20000.0,
            tilt_db_per_oct: 4.5,
            tilt_pivot_hz: 1000.0,
            db_floor: DB_FLOOR,
            attack_ms: 0.0,
            release_ms: 300.0,
        };
        let frame = VizFrame::silent();
        Self {
            engine: SpectrumEngine::new(sample_rate, config),
            frame,
            snapshot: SeqLock::new(frame),
            last_ratio: 1.0,
            last_iir_amount: 1.0,
            last_monitoring: 0,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: i32) {
        self.engine.set_sample_rate(sample_rate);
        self.reset();
    }

    pub fn reset(&mut self) {
        self.engine.reset();
        self.frame = VizFrame::silent();
        self.snapshot.write(&self.frame);
    }

    pub fn snapshot(&self) -> &SeqLock<VizFrame> {
        &self.snapshot
    }

    pub fn feed(
        &mut self,
        input: &[f32],
        output: &[f32],
        ratio: f64,
        iir_amount: f64,
        monitoring: i32,
    ) {
        self.engine.feed(input);

        let bins = self.engine.smoothed_bins();
        self.frame.input_db[..bins.len()].copy_from_slice(bins);

        self.last_ratio = ratio;
        self.last_iir_amount = iir_amount;
        self.last_monitoring = monitoring;
        self.derive_output_spectrum(ratio, iir_amount, monitoring);

        let (in_peak, _) = PeakMeter::measure(input);
        let (out_peak, _) = PeakMeter::measure(output);

        let n = input.len();
        if n > 0 {
            let mut in_sq = 0.0f64;
            let mut out_sq = 0.0f64;
            for i in 0..n {
                in_sq += (input[i] as f64) * (input[i] as f64);
                out_sq += (output[i] as f64) * (output[i] as f64);
            }
            let in_rms = (in_sq / n as f64).sqrt();
            let out_rms = (out_sq / n as f64).sqrt();
            let gr = if in_rms > 1e-9 && out_rms > 1e-9 {
                (20.0 * (in_rms / out_rms).log10()).max(0.0)
            } else {
                0.0
            };
            let prev = self.frame.gr_db as f64;
            let smoothed = prev * 0.6 + gr * 0.4;
            self.frame.gr_db = smoothed as f32;
            self.frame.input_level = level_to_norm(in_peak);
            self.frame.output_level = level_to_norm(out_peak);
        }

        self.frame.active = true;
        self.snapshot.write(&self.frame);
    }

    // DAW 暂停后由外部调用，让所有可视化数据衰减
    pub fn decay(&mut self) {
        self.engine.decay_to_silence();

        let bins = self.engine.smoothed_bins();
        self.frame.input_db[..bins.len()].copy_from_slice(bins);
        self.derive_output_spectrum(
            self.last_ratio,
            self.last_iir_amount,
            self.last_monitoring,
        );

        self.frame.gr_db *= 0.85;
        self.frame.input_level *= 0.9;
        self.frame.output_level *= 0.9;
        self.frame.active = false;
        self.snapshot.write(&self.frame);
    }

    fn derive_output_spectrum(&mut self, ratio: f64, iir_amount: f64, monitoring: i32) {
        let a = iir_amount.clamp(0.0, 1.0);
        let inv_ratio = (1.0 / ratio.max(1.0)).clamp(0.0, 1.0);
        let one_minus_a = 1.0 - a;
        let sr = self.engine.sample_rate();
        let centers = self.engine.band_centers();
        let db_floor = self.engine.db_floor();

        for b in 0..SPECTRUM_BINS {
            let omega = 2.0 * std::f64::consts::PI * centers[b] / sr;
            let cos_w = omega.cos();
            let sin_w = omega.sin();

            let denom_re = 1.0 - one_minus_a * cos_w;
            let denom_im = one_minus_a * sin_w;
            let denom_mag2 = denom_re * denom_re + denom_im * denom_im;
            let lp_re = a * denom_re / denom_mag2;
            let lp_im = -a * denom_im / denom_mag2;

            let h_re = lp_re * (1.0 - inv_ratio) + inv_ratio;
            let h_im = lp_im * (1.0 - inv_ratio);

            let (g_re, g_im) = if monitoring == 1 {
                (1.0 - h_re, -h_im)
            } else {
                (h_re, h_im)
            };
            let gain = (g_re * g_re + g_im * g_im).sqrt().max(1e-6);
            let gain_db = (20.0 * gain.log10()) as f32;

            let out_db = self.frame.input_db[b] + gain_db;
            self.frame.output_db[b] = out_db.max(db_floor);
        }
    }
}
