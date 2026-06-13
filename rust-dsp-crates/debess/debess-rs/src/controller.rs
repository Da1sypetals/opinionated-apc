use crate::kernel::{DeBessKernel, Derived};
use crate::parameters::{DEFAULTS, parameter};
use crate::viz::{VizAnalyzer, VizFrame};
use viz_core::SeqLock;

// 立体声 DeBess 控制器：两个独立单声道处理核 + 可视化分析
pub struct DeBessController {
    sample_rate: i32,
    params: [f64; parameter::COUNT],
    kernel_l: DeBessKernel,
    kernel_r: DeBessKernel,
    viz: VizAnalyzer,
    // 复用的单声道分析缓冲（输入/输出 mono mix）
    mono_in: Vec<f32>,
    mono_out: Vec<f32>,
}

impl DeBessController {
    pub fn new(sample_rate: i32) -> Self {
        Self {
            sample_rate,
            params: DEFAULTS,
            kernel_l: DeBessKernel::new(),
            kernel_r: DeBessKernel::new(),
            viz: VizAnalyzer::new(sample_rate),
            mono_in: Vec::new(),
            mono_out: Vec::new(),
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: i32) {
        self.sample_rate = sample_rate;
        self.viz.set_sample_rate(sample_rate);
        self.clear_buffers();
    }

    pub fn set_parameter(&mut self, index: usize, value: f64) {
        if index < parameter::COUNT {
            self.params[index] = value;
        }
    }

    pub fn get_parameter(&self, index: usize) -> f64 {
        if index < parameter::COUNT {
            self.params[index]
        } else {
            0.0
        }
    }

    pub fn clear_buffers(&mut self) {
        self.kernel_l.reset();
        self.kernel_r.reset();
        self.viz.reset();
    }

    pub fn viz_snapshot(&self) -> &SeqLock<VizFrame> {
        self.viz.snapshot()
    }

    pub fn viz_decay(&mut self) {
        self.viz.decay();
    }

    pub fn process(
        &mut self,
        in_l: &[f32],
        in_r: &[f32],
        out_l: &mut [f32],
        out_r: &mut [f32],
        n: usize,
    ) {
        let derived = Derived::from_params(&self.params, self.sample_rate as f64);

        for i in 0..n {
            out_l[i] = self.kernel_l.process_sample(in_l[i], &derived);
            out_r[i] = self.kernel_r.process_sample(in_r[i], &derived);
        }

        // 可视化分析信号用 mono mix
        if self.mono_in.len() < n {
            self.mono_in.resize(n, 0.0);
            self.mono_out.resize(n, 0.0);
        }
        for i in 0..n {
            self.mono_in[i] = 0.5 * (in_l[i] + in_r[i]);
            self.mono_out[i] = 0.5 * (out_l[i] + out_r[i]);
        }
        // 用去齿音滤波器的真实频响把 output 频谱由 input 推导出来，
        // 因此需要当前 ratio、低通系数（FILTER）与监听模式
        let ratio = self.kernel_l.ratio().max(self.kernel_r.ratio());
        self.viz.feed(
            &self.mono_in[..n],
            &self.mono_out[..n],
            ratio,
            derived.iir_amount,
            derived.monitoring,
        );
    }
}
