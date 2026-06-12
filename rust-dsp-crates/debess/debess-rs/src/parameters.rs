pub mod parameter {
    // 与 Airwindows DeBess 的 kParam_* 一一对应
    pub const INTENSITY: usize = 0;
    pub const SHARPNESS: usize = 1;
    pub const DEPTH: usize = 2;
    pub const FILTER: usize = 3;
    pub const SENSE_MON: usize = 4;

    pub const COUNT: usize = 5;
}

// 默认值，与 DeBess.h 中 kDefaultValue_Param* 一致
pub const DEFAULTS: [f64; parameter::COUNT] = [
    0.0, // Intensity
    0.5, // Sharpness
    0.5, // Depth
    0.5, // Filter
    0.0, // Sense Mon
];
