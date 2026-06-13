// 无状态 per-block 峰值/RMS 测量
pub struct PeakMeter;

impl PeakMeter {
    pub fn measure(samples: &[f32]) -> (f32, f32) {
        let mut peak = 0.0f32;
        let mut sq_sum = 0.0f64;
        for &s in samples {
            peak = peak.max(s.abs());
            sq_sum += (s as f64) * (s as f64);
        }
        let rms = if samples.is_empty() {
            0.0
        } else {
            (sq_sum / samples.len() as f64).sqrt() as f32
        };
        (peak, rms)
    }
}

// 把峰值线性幅度映射到 0..1 的显示刻度（约 -60dB..0dB）
pub fn level_to_norm(peak: f32) -> f32 {
    if peak <= 1e-9 {
        return 0.0;
    }
    let db = 20.0 * peak.log10();
    ((db + 60.0) / 60.0).clamp(0.0, 1.0)
}
