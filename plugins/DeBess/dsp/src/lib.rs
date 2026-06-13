use std::ffi::CString;
use std::fmt::Write as _;
use std::os::raw::c_char;

use debess_rs::{DeBessController, parameter};

// 不透明引擎句柄，C++ 侧持有指针
pub struct DeBessEngine {
    controller: DeBessController,
    params: [f64; parameter::COUNT],
    // 缓存 viz JSON，使返回的指针在下次调用前保持有效
    viz_json: CString,
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_create(sample_rate: i32) -> *mut DeBessEngine {
    let mut controller = DeBessController::new(sample_rate);
    let params = debess_rs::DEFAULTS;
    for i in 0..parameter::COUNT {
        controller.set_parameter(i, params[i]);
    }
    controller.clear_buffers();

    Box::into_raw(Box::new(DeBessEngine {
        controller,
        params,
        viz_json: CString::new("{}").unwrap(),
    }))
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_destroy(engine: *mut DeBessEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_set_sample_rate(engine: *mut DeBessEngine, sample_rate: i32) {
    let engine = unsafe { &mut *engine };
    engine.controller.set_sample_rate(sample_rate);
    for i in 0..parameter::COUNT {
        engine.controller.set_parameter(i, engine.params[i]);
    }
    engine.controller.clear_buffers();
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_set_parameter(engine: *mut DeBessEngine, param_index: u32, value: f32) {
    let engine = unsafe { &mut *engine };
    let idx = param_index as usize;
    if idx < parameter::COUNT {
        engine.params[idx] = value as f64;
        engine.controller.set_parameter(idx, value as f64);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_process(
    engine: *mut DeBessEngine,
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

    engine
        .controller
        .process(input_l, input_r, output_l, output_r, n);
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_get_parameter_count() -> u32 {
    parameter::COUNT as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_get_parameter(engine: *mut DeBessEngine, param_index: u32) -> f32 {
    let engine = unsafe { &*engine };
    engine.controller.get_parameter(param_index as usize) as f32
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_get_state(
    engine: *mut DeBessEngine,
    buffer: *mut u8,
    buffer_size: u32,
) -> u32 {
    let engine = unsafe { &*engine };
    let required = parameter::COUNT * 8;
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

#[unsafe(no_mangle)]
pub extern "C" fn debess_set_state(engine: *mut DeBessEngine, buffer: *const u8, size: u32) {
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
        engine.controller.set_parameter(i, val);
    }
    engine.controller.clear_buffers();
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_clear_buffers(engine: *mut DeBessEngine) {
    let engine = unsafe { &mut *engine };
    engine.controller.clear_buffers();
}

#[unsafe(no_mangle)]
pub extern "C" fn debess_viz_decay(engine: *mut DeBessEngine) {
    let engine = unsafe { &mut *engine };
    engine.controller.viz_decay();
}

// 读取可视化快照并格式化为 JSON，返回的指针在下次调用本函数前有效
// 仅 UI 线程调用
#[unsafe(no_mangle)]
pub extern "C" fn debess_get_viz_json(engine: *mut DeBessEngine) -> *const c_char {
    let engine = unsafe { &mut *engine };
    let frame = engine.controller.viz_snapshot().read();

    let mut s = String::with_capacity(2048);
    s.push_str("{\"in\":[");
    for (i, v) in frame.input_db.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        let _ = write!(s, "{:.1}", v);
    }
    s.push_str("],\"out\":[");
    for (i, v) in frame.output_db.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        let _ = write!(s, "{:.1}", v);
    }
    let _ = write!(
        s,
        "],\"gr\":{:.2},\"il\":{:.3},\"ol\":{:.3},\"a\":{}}}",
        frame.gr_db, frame.input_level, frame.output_level,
        if frame.active { 1 } else { 0 }
    );

    engine.viz_json = CString::new(s).unwrap();
    engine.viz_json.as_ptr()
}
