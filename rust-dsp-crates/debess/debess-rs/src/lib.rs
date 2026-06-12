pub mod controller;
pub mod kernel;
pub mod parameters;
pub mod viz;

pub use controller::DeBessController;
pub use parameters::{DEFAULTS, parameter};
pub use viz::{SPECTRUM_BINS, VizFrame};

#[cfg(test)]
mod tests {
    use super::*;

    // 基本健全性：默认参数（Intensity=0）下应近乎直通（仅 dither 极小扰动）
    #[test]
    fn test_passthrough_at_zero_intensity() {
        let mut ctrl = DeBessController::new(48000);
        let n = 512;
        let input: Vec<f32> = (0..n)
            .map(|i| (i as f32 * 0.05).sin() * 0.5)
            .collect();
        let zeros = vec![0.0f32; n];
        let mut out_l = vec![0.0f32; n];
        let mut out_r = vec![0.0f32; n];
        let _ = &zeros;
        ctrl.process(&input, &input, &mut out_l, &mut out_r, n);

        for i in 0..n {
            let diff = (out_l[i] - input[i]).abs();
            assert!(
                diff < 1e-3,
                "intensity=0 应近乎直通, i={} diff={}",
                i,
                diff
            );
        }
    }

    // 输出不应包含 NaN/Inf
    #[test]
    fn test_no_nan_with_strong_settings() {
        let mut ctrl = DeBessController::new(44100);
        ctrl.set_parameter(parameter::INTENSITY, 1.0);
        ctrl.set_parameter(parameter::SHARPNESS, 0.8);
        ctrl.set_parameter(parameter::DEPTH, 0.3);
        ctrl.set_parameter(parameter::FILTER, 0.5);

        let n = 1024;
        let input: Vec<f32> = (0..n)
            .map(|i| ((i as f32 * 0.3).sin() + (i as f32 * 2.7).sin()) * 0.4)
            .collect();
        let mut out_l = vec![0.0f32; n];
        let mut out_r = vec![0.0f32; n];

        for _ in 0..8 {
            ctrl.process(&input, &input, &mut out_l, &mut out_r, n);
            for i in 0..n {
                assert!(out_l[i].is_finite(), "输出必须有限 i={}", i);
            }
        }
    }

    // 可视化快照应可被读取且数值有限
    #[test]
    fn test_viz_snapshot_finite() {
        let mut ctrl = DeBessController::new(48000);
        ctrl.set_parameter(parameter::INTENSITY, 0.8);
        ctrl.set_parameter(parameter::SHARPNESS, 0.6);

        let n = 2048;
        let input: Vec<f32> = (0..n)
            .map(|i| (i as f32 * 0.8).sin() * 0.5)
            .collect();
        let mut out_l = vec![0.0f32; n];
        let mut out_r = vec![0.0f32; n];
        ctrl.process(&input, &input, &mut out_l, &mut out_r, n);

        let frame = ctrl.viz_snapshot().read();
        assert!(frame.gr_db.is_finite());
        assert!(frame.input_level >= 0.0 && frame.input_level <= 1.0);
        for b in 0..SPECTRUM_BINS {
            assert!(frame.input_db[b].is_finite());
            assert!(frame.output_db[b].is_finite());
        }
    }

    // Sense Mon 模式：输出应为 dry - processed
    #[test]
    fn test_sense_monitoring_runs() {
        let mut ctrl = DeBessController::new(48000);
        ctrl.set_parameter(parameter::INTENSITY, 0.7);
        ctrl.set_parameter(parameter::SENSE_MON, 1.0);
        let n = 256;
        let input: Vec<f32> = (0..n).map(|i| (i as f32 * 0.9).sin() * 0.5).collect();
        let mut out_l = vec![0.0f32; n];
        let mut out_r = vec![0.0f32; n];
        ctrl.process(&input, &input, &mut out_l, &mut out_r, n);
        for i in 0..n {
            assert!(out_l[i].is_finite());
        }
    }
}
