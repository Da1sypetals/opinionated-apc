use std::ffi::CString;
use std::fmt::Write as _;
use std::os::raw::c_char;

use zlcompressor_rs::controller::Controller;
use zlcompressor_rs::params::{self, idx};

pub struct ZLCompEngine {
    controller: Controller,
    param_cache: [f32; idx::COUNT],
    input_db: f32,
    output_db: f32,
    viz_json: CString,
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_create(sample_rate: i32) -> *mut ZLCompEngine {
    let mut controller = Controller::new();
    controller.prepare(sample_rate as f64, 8192);

    let defaults = params::default_params();
    let mut param_cache = [0.0f32; idx::COUNT];
    for i in 0..idx::COUNT {
        param_cache[i] = defaults[i];
        controller.set_param(i, defaults[i]);
    }

    Box::into_raw(Box::new(ZLCompEngine {
        controller,
        param_cache,
        input_db: -120.0,
        output_db: -120.0,
        viz_json: CString::new("{}").unwrap(),
    }))
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_destroy(engine: *mut ZLCompEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_set_sample_rate(
    engine: *mut ZLCompEngine,
    sample_rate: i32,
    max_block_size: i32,
) {
    let engine = unsafe { &mut *engine };
    engine
        .controller
        .prepare(sample_rate as f64, max_block_size as usize);
    for i in 0..idx::COUNT {
        engine.controller.set_param(i, engine.param_cache[i]);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_set_parameter(engine: *mut ZLCompEngine, param_index: u32, value: f32) {
    let engine = unsafe { &mut *engine };
    let i = param_index as usize;
    if i < idx::COUNT {
        engine.param_cache[i] = value;
        engine.controller.set_param(i, value);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_process(
    engine: *mut ZLCompEngine,
    in_l: *const f32,
    in_r: *const f32,
    out_l: *mut f32,
    out_r: *mut f32,
    num_samples: u32,
) {
    let engine = unsafe { &mut *engine };
    let n = num_samples as usize;
    let output_l = unsafe { std::slice::from_raw_parts_mut(out_l, n) };
    let output_r = unsafe { std::slice::from_raw_parts_mut(out_r, n) };

    // 当 in != out 时，先复制输入到输出（避免同时创建 &[] 和 &mut[] 的 UB）
    if in_l != out_l as *const f32 {
        let input_l = unsafe { std::slice::from_raw_parts(in_l, n) };
        output_l.copy_from_slice(input_l);
    }
    if in_r != out_r as *const f32 {
        let input_r = unsafe { std::slice::from_raw_parts(in_r, n) };
        output_r.copy_from_slice(input_r);
    }

    engine.input_db = peak_db(output_l, output_r);
    engine.controller.process(output_l, output_r);
    engine.output_db = peak_db(output_l, output_r);
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_get_parameter_count() -> u32 {
    idx::COUNT as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_get_parameter(engine: *mut ZLCompEngine, param_index: u32) -> f32 {
    let engine = unsafe { &*engine };
    let i = param_index as usize;
    if i < idx::COUNT {
        engine.param_cache[i]
    } else {
        0.0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_get_state(
    engine: *mut ZLCompEngine,
    buffer: *mut u8,
    buffer_size: u32,
) -> u32 {
    let engine = unsafe { &*engine };
    let required = idx::COUNT * 4;
    if buffer.is_null() || (buffer_size as usize) < required {
        return required as u32;
    }
    let dest = unsafe { std::slice::from_raw_parts_mut(buffer, required) };
    for (i, &val) in engine.param_cache.iter().enumerate() {
        let bytes = val.to_le_bytes();
        dest[i * 4..(i + 1) * 4].copy_from_slice(&bytes);
    }
    required as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_set_state(engine: *mut ZLCompEngine, buffer: *const u8, size: u32) {
    let engine = unsafe { &mut *engine };
    let required = idx::COUNT * 4;
    if buffer.is_null() || (size as usize) < required {
        return;
    }
    let src = unsafe { std::slice::from_raw_parts(buffer, required) };
    for i in 0..idx::COUNT {
        let bytes: [u8; 4] = src[i * 4..(i + 1) * 4].try_into().unwrap();
        let val = f32::from_le_bytes(bytes);
        engine.param_cache[i] = val;
        engine.controller.set_param(i, val);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_clear_buffers(engine: *mut ZLCompEngine) {
    let _engine = unsafe { &mut *engine };
    // Controller 没有 clear_buffers 方法，prepare 做了初始化
}

// 可视化: 返回 JSON，包含当前 GR 值和压缩曲线参数
#[unsafe(no_mangle)]
pub extern "C" fn zlcomp_get_viz_json(engine: *mut ZLCompEngine) -> *const c_char {
    let engine = unsafe { &mut *engine };
    let gr = &engine.controller.gain_reduction;
    let comp = engine.controller.compression_computer();

    let mut s = String::with_capacity(256);
    let _ = write!(
        s,
        "{{\"gr_l\":{:.2},\"gr_r\":{:.2},\"in_db\":{:.2},\"out_db\":{:.2},\"th\":{:.1},\"rat\":{:.2},\"knee\":{:.2},\"sr\":{},\"lat\":{}}}",
        gr.left,
        gr.right,
        engine.input_db,
        engine.output_db,
        comp.get_threshold(),
        comp.get_ratio(),
        comp.get_knee_w(),
        engine.controller.sample_rate() as u32,
        engine.controller.latency(),
    );

    engine.viz_json = CString::new(s).unwrap();
    engine.viz_json.as_ptr()
}

fn peak_db(left: &[f32], right: &[f32]) -> f32 {
    let mut peak = 0.0f32;
    for i in 0..left.len() {
        peak = peak.max(left[i].abs()).max(right[i].abs());
    }
    if peak <= 1.0e-12 {
        -120.0
    } else {
        20.0 * peak.log10()
    }
}
