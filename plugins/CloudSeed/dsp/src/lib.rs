use cloudseed_rs::dsp::reverb_controller::ReverbController;
use cloudseed_rs::parameters::parameter;
use cloudseed_rs::programs::PROGRAM_DARK_PLATE;


/// 不透明引擎句柄，C++ 侧持有指针
pub struct CloudSeedEngine {
    reverb: ReverbController,
    /// 缓存参数值，用于状态序列化
    params: [f64; parameter::COUNT],
}

/// 创建引擎实例，加载 Dark Plate 预设
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_create(sample_rate: i32) -> *mut CloudSeedEngine {
    let mut reverb = ReverbController::new(sample_rate);
    let params = PROGRAM_DARK_PLATE;
    for i in 0..parameter::COUNT {
        reverb.set_parameter(i, params[i]);
    }
    reverb.clear_buffers();

    Box::into_raw(Box::new(CloudSeedEngine { reverb, params }))
}

/// 销毁引擎实例
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_destroy(engine: *mut CloudSeedEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// 设置采样率（宿主采样率变更时调用）
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_set_sample_rate(engine: *mut CloudSeedEngine, sample_rate: i32) {
    let engine = unsafe { &mut *engine };
    engine.reverb.set_samplerate(sample_rate);
    // 重新应用所有参数
    for i in 0..parameter::COUNT {
        engine.reverb.set_parameter(i, engine.params[i]);
    }
    engine.reverb.clear_buffers();
}

/// 设置单个参数（归一化值 0.0-1.0）
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_set_parameter(
    engine: *mut CloudSeedEngine,
    param_index: u32,
    value: f32,
) {
    let engine = unsafe { &mut *engine };
    let idx = param_index as usize;
    if idx < parameter::COUNT {
        engine.params[idx] = value as f64;
        engine.reverb.set_parameter(idx, value as f64);
    }
}

/// 处理音频 buffer（立体声交错不需要，直接传分离的L/R指针）
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_process(
    engine: *mut CloudSeedEngine,
    in_l: *const f32,
    in_r: *const f32,
    out_l: *mut f32,
    out_r: *mut f32,
    num_samples: u32,
) {
    let engine = unsafe { &mut *engine };
    let n = num_samples as usize;
    let input_l = unsafe { std::slice::from_raw_parts(in_l, n) };
    let input_r = unsafe { std::slice::from_raw_parts(in_r, n) };
    let output_l = unsafe { std::slice::from_raw_parts_mut(out_l, n) };
    let output_r = unsafe { std::slice::from_raw_parts_mut(out_r, n) };

    engine.reverb.process(input_l, input_r, output_l, output_r, n);
}

/// 获取参数数量
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_get_parameter_count() -> u32 {
    parameter::COUNT as u32
}

/// 获取当前参数值
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_get_parameter(engine: *mut CloudSeedEngine, param_index: u32) -> f32 {
    let engine = unsafe { &*engine };
    let idx = param_index as usize;
    if idx < parameter::COUNT {
        engine.params[idx] as f32
    } else {
        0.0
    }
}

/// 序列化全部参数到 buffer，返回写入的字节数
/// buffer 必须至少 parameter::COUNT * 8 字节
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_get_state(
    engine: *mut CloudSeedEngine,
    buffer: *mut u8,
    buffer_size: u32,
) -> u32 {
    let engine = unsafe { &*engine };
    let required = parameter::COUNT * 8; // f64 = 8 bytes each
    if buffer.is_null() || (buffer_size as usize) < required {
        return required as u32;
    }
    let dest = unsafe { std::slice::from_raw_parts_mut(buffer, required) };
    for (i, &val) in engine.params.iter().enumerate() {
        let bytes = val.to_le_bytes();
        dest[i * 8..(i + 1) * 8].copy_from_slice(&bytes);
    }
    required as u32
}

/// 从 buffer 反序列化参数
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_set_state(
    engine: *mut CloudSeedEngine,
    buffer: *const u8,
    size: u32,
) {
    let engine = unsafe { &mut *engine };
    let required = parameter::COUNT * 8;
    if buffer.is_null() || (size as usize) < required {
        return;
    }
    let src = unsafe { std::slice::from_raw_parts(buffer, required) };
    for i in 0..parameter::COUNT {
        let bytes: [u8; 8] = src[i * 8..(i + 1) * 8].try_into().unwrap();
        let val = f64::from_le_bytes(bytes);
        engine.params[i] = val;
        engine.reverb.set_parameter(i, val);
    }
    engine.reverb.clear_buffers();
}

/// 清除所有 delay buffer（用于预设切换等场景）
#[unsafe(no_mangle)]
pub extern "C" fn cloudseed_clear_buffers(engine: *mut CloudSeedEngine) {
    let engine = unsafe { &mut *engine };
    engine.reverb.clear_buffers();
}
