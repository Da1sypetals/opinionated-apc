use crate::parameters::parameter;

// Range 旋钮：最大衰减量上限（dB）
pub const RANGE_MAX_DB: f64 = 36.0;
// Frequency 旋钮：齿音分频点范围（Hz，对数）
pub const FREQ_MIN: f64 = 2000.0;
pub const FREQ_MAX: f64 = 16000.0;

// 单声道处理核，逐字移植自 Airwindows DeBess::DeBessKernel
// 状态数组大小与原始 C++ 一致（41），sharpness 上限为 40
pub struct DeBessKernel {
    s: [f64; 41],
    m: [f64; 41],
    c: [f64; 41],
    ratio_a: f64,
    ratio_b: f64,
    iir_sample_a: f64,
    iir_sample_b: f64,
    flip: bool,
    fpd: u32,
}

// 每个 block 计算一次的派生参数，对应原始 Process 开头的本地变量
#[derive(Clone, Copy)]
pub struct Derived {
    pub intensity: f64,
    pub sharpness: f64,
    pub speed: f64,
    pub depth: f64,
    pub iir_amount: f64,
    pub monitoring: i32,
}

impl Derived {
    // 对应 Process 开头由 GetParameter 计算派生量的部分
    pub fn from_params(params: &[f64; parameter::COUNT], sample_rate: f64) -> Self {
        let mut overallscale = 1.0;
        overallscale /= 44100.0;
        overallscale *= sample_rate;

        let intensity = params[parameter::INTENSITY].powi(5) * (8192.0 / overallscale);
        let mut sharpness = params[parameter::SHARPNESS] * 40.0;
        if sharpness < 2.0 {
            sharpness = 2.0;
        }
        let speed = 0.1 / sharpness;

        // Range：DEPTH 映射为最大衰减量（dB），方向正向、感知线性。
        // depth 是 ratio 上限：DEPTH=0 → 1.0（关闭），DEPTH=1 → ~63（约 -36 dB）
        let max_reduction_db = params[parameter::DEPTH] * RANGE_MAX_DB;
        let depth = 10f64.powf(max_reduction_db / 20.0);

        // Frequency：FILTER 映射为齿音分频点（Hz，对数 FREQ_MIN..FREQ_MAX），
        // 再换算为一阶低通系数（齿音 = input - 该低通）
        let fc = FREQ_MIN * (FREQ_MAX / FREQ_MIN).powf(params[parameter::FILTER]);
        let iir_amount = 1.0 - (-2.0 * std::f64::consts::PI * fc / sample_rate).exp();

        let monitoring = params[parameter::SENSE_MON] as i32;

        Self {
            intensity,
            sharpness,
            speed,
            depth,
            iir_amount,
            monitoring,
        }
    }
}

impl DeBessKernel {
    pub fn new() -> Self {
        let mut k = Self {
            s: [0.0; 41],
            m: [0.0; 41],
            c: [0.0; 41],
            ratio_a: 1.0,
            ratio_b: 1.0,
            iir_sample_a: 0.0,
            iir_sample_b: 0.0,
            flip: false,
            fpd: 0,
        };
        k.reset();
        k
    }

    // 对应 DeBessKernel::Reset
    pub fn reset(&mut self) {
        for x in 0..41 {
            self.s[x] = 0.0;
            self.m[x] = 0.0;
            self.c[x] = 0.0;
        }
        self.ratio_a = 1.0;
        self.ratio_b = 1.0;
        self.iir_sample_a = 0.0;
        self.iir_sample_b = 0.0;
        self.flip = false;
        // 原始用 rand() 播种一个非零 fpd，这里用固定非零种子即可（仅用于 dither PRNG）
        self.fpd = 17;
    }

    // 当前去齿音比率（>=1），用于可视化推导频响。两路交替使用，取较大者代表当前衰减强度
    #[inline]
    pub fn ratio(&self) -> f64 {
        self.ratio_a.max(self.ratio_b)
    }

    // 处理单个样本，逐字移植自 Process 的 while 循环体
    #[inline]
    pub fn process_sample(&mut self, input: f32, d: &Derived) -> f32 {
        let dry = input as f64;
        let mut input_sample = input as f64;
        if input_sample.abs() < 1.18e-37 {
            input_sample = self.fpd as f64 * 1.18e-37;
        }

        let sh = d.sharpness as usize; // C++ 中 int 截断
        let sharpness = d.sharpness;

        self.s[0] = input_sample; // [0] 与 [1] 都会是输入样本
        for x in (1..=sh).rev() {
            self.s[x] = self.s[x - 1];
        } // 建立一组 slew

        self.m[1] = (self.s[1] - self.s[2]) * ((self.s[1] - self.s[2]) / 1.3);
        for x in (2..sh).rev() {
            self.m[x] = (self.s[x] - self.s[x + 1]) * ((self.s[x - 1] - self.s[x]) / 1.3);
        } // 建立 slew 的 slew

        let mut sense = (self.m[1] - self.m[2]).abs() * sharpness * sharpness;
        for x in (1..sh).rev() {
            let mult = (self.m[x] - self.m[x + 1]).abs() * sharpness * sharpness;
            if mult < 1.0 {
                sense *= mult;
            }
        } // sense 是 slew 的 slew 相互相乘

        sense = 1.0 + (d.intensity * d.intensity * sense);
        if sense > d.intensity {
            sense = d.intensity;
        }

        if self.flip {
            self.iir_sample_a =
                (self.iir_sample_a * (1.0 - d.iir_amount)) + (input_sample * d.iir_amount);
            self.ratio_a = (self.ratio_a * (1.0 - d.speed)) + (sense * d.speed);
            if self.ratio_a > d.depth {
                self.ratio_a = d.depth;
            }
            if self.ratio_a > 1.0 {
                input_sample =
                    self.iir_sample_a + ((input_sample - self.iir_sample_a) / self.ratio_a);
            }
        } else {
            self.iir_sample_b =
                (self.iir_sample_b * (1.0 - d.iir_amount)) + (input_sample * d.iir_amount);
            self.ratio_b = (self.ratio_b * (1.0 - d.speed)) + (sense * d.speed);
            if self.ratio_b > d.depth {
                self.ratio_b = d.depth;
            }
            if self.ratio_a > 1.0 {
                input_sample =
                    self.iir_sample_b + ((input_sample - self.iir_sample_b) / self.ratio_b);
            }
        }
        self.flip = !self.flip;

        if d.monitoring == 1 {
            input_sample = dry - input_sample;
        } // sense monitoring

        // begin 32 bit floating point dither
        let (_, expon) = libm::frexpf(input_sample as f32);
        self.fpd ^= self.fpd << 13;
        self.fpd ^= self.fpd >> 17;
        self.fpd ^= self.fpd << 5;
        input_sample += (self.fpd as f64 - 0x7fffffff_u32 as f64)
            * 5.5e-36
            * 2f64.powi(expon + 62);
        // end 32 bit floating point dither

        input_sample as f32
    }
}

impl Default for DeBessKernel {
    fn default() -> Self {
        Self::new()
    }
}
