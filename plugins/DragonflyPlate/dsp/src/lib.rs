use std::ffi::c_void;
use std::fmt::Write;
use std::ptr;

const PARAM_COUNT: usize = 9;
const VIZ_SAMPLE_RATE: i32 = 40960;
const VIZ_SECONDS: usize = 8;
const VIZ_FFT_SIZE: usize = 1024;
const VIZ_COLUMNS: usize = 96;
const VIZ_BINS: usize = 64;

const DEFAULT_PARAMS: [f32; PARAM_COUNT] = [
    80.0, 20.0, 1.0, 100.0, 0.0, 0.4, 200.0, 16000.0, 13000.0,
];

const PARAM_MINS: [f32; PARAM_COUNT] = [0.0, 0.0, 0.0, 50.0, 0.0, 0.1, 0.0, 1000.0, 1000.0];
const PARAM_MAXS: [f32; PARAM_COUNT] = [100.0, 100.0, 2.0, 150.0, 100.0, 10.0, 200.0, 16000.0, 16000.0];

#[repr(C)]
struct KissFftCpx {
    r: f32,
    i: f32,
}

unsafe extern "C" {
    fn dragonfly_plate_create(sample_rate: i32) -> *mut c_void;
    fn dragonfly_plate_destroy(engine: *mut c_void);
    fn dragonfly_plate_set_sample_rate(engine: *mut c_void, sample_rate: i32);
    fn dragonfly_plate_set_parameter(engine: *mut c_void, index: u32, value: f32);
    fn dragonfly_plate_process(
        engine: *mut c_void,
        in_l: *const f32,
        in_r: *const f32,
        out_l: *mut f32,
        out_r: *mut f32,
        frames: u32,
    );
    fn dragonfly_plate_clear_buffers(engine: *mut c_void);
    fn kiss_fftr_alloc(
        nfft: i32,
        inverse_fft: i32,
        mem: *mut c_void,
        lenmem: *mut usize,
    ) -> *mut c_void;
    fn kiss_fftr(cfg: *mut c_void, timedata: *const f32, freqdata: *mut KissFftCpx);
    fn free(ptr: *mut c_void);
}

pub struct DragonflyPlateEngine {
    dsp: *mut c_void,
    viz_dsp: *mut c_void,
    params: [f32; PARAM_COUNT],
    input_db: f32,
    output_db: f32,
    viz_dirty: bool,
    viz_json: String,
}

impl Drop for DragonflyPlateEngine {
    fn drop(&mut self) {
        unsafe {
            dragonfly_plate_destroy(self.dsp);
            dragonfly_plate_destroy(self.viz_dsp);
        }
    }
}

fn clamp_param(index: usize, value: f32) -> f32 {
    value.clamp(PARAM_MINS[index], PARAM_MAXS[index])
}

fn db_from_peak(peak: f32) -> f32 {
    20.0 * peak.max(1.0e-9).log10()
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < bytes.len() {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

fn next_noise(seed: &mut u32) -> f32 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    ((*seed as f32 / u32::MAX as f32) * 2.0 - 1.0) * 0.15
}

impl DragonflyPlateEngine {
    fn new(sample_rate: i32) -> Self {
        let dsp = unsafe { dragonfly_plate_create(sample_rate) };
        let viz_dsp = unsafe { dragonfly_plate_create(VIZ_SAMPLE_RATE) };
        let engine = Self {
            dsp,
            viz_dsp,
            params: DEFAULT_PARAMS,
            input_db: -180.0,
            output_db: -180.0,
            viz_dirty: true,
            viz_json: String::new(),
        };
        for i in 0..PARAM_COUNT {
            unsafe {
                dragonfly_plate_set_parameter(engine.dsp, i as u32, engine.params[i]);
                dragonfly_plate_set_parameter(engine.viz_dsp, i as u32, engine.params[i]);
            }
        }
        engine
    }

    fn render_viz(&mut self) {
        unsafe {
            dragonfly_plate_clear_buffers(self.viz_dsp);
            for i in 0..PARAM_COUNT {
                dragonfly_plate_set_parameter(self.viz_dsp, i as u32, self.params[i]);
            }
        }

        let total = VIZ_SAMPLE_RATE as usize * VIZ_SECONDS;
        let mut in_l = vec![0.0f32; total];
        let mut in_r = vec![0.0f32; total];
        let mut out_l = vec![0.0f32; total];
        let mut out_r = vec![0.0f32; total];
        let mut seed = 0x4d59_4650u32;
        for i in 0..8192 {
            let sample = next_noise(&mut seed);
            in_l[i] = sample;
            in_r[i] = sample;
        }

        let mut offset = 0;
        while offset < total {
            let frames = (total - offset).min(256);
            unsafe {
                dragonfly_plate_process(
                    self.viz_dsp,
                    in_l[offset..].as_ptr(),
                    in_r[offset..].as_ptr(),
                    out_l[offset..].as_mut_ptr(),
                    out_r[offset..].as_mut_ptr(),
                    frames as u32,
                );
            }
            offset += frames;
        }

        let cfg = unsafe { kiss_fftr_alloc(VIZ_FFT_SIZE as i32, 0, ptr::null_mut(), ptr::null_mut()) };
        let mut window = vec![0.0f32; VIZ_FFT_SIZE];
        let mut spectrum = (0..=VIZ_FFT_SIZE / 2)
            .map(|_| KissFftCpx { r: 0.0, i: 0.0 })
            .collect::<Vec<_>>();
        let mut encoded_columns = Vec::with_capacity(VIZ_COLUMNS);

        for column in 0..VIZ_COLUMNS {
            let start = column * (total - VIZ_FFT_SIZE) / (VIZ_COLUMNS - 1);
            for i in 0..VIZ_FFT_SIZE {
                let hann = 0.5 - 0.5 * ((2.0 * std::f32::consts::PI * i as f32) / (VIZ_FFT_SIZE - 1) as f32).cos();
                window[i] = 0.5 * (out_l[start + i] + out_r[start + i]) * hann;
            }
            unsafe { kiss_fftr(cfg, window.as_ptr(), spectrum.as_mut_ptr()) };
            let mut bytes = Vec::with_capacity(VIZ_BINS);
            for bin in 0..VIZ_BINS {
                let norm = bin as f32 / (VIZ_BINS - 1) as f32;
                let freq = 125.0_f32 * (16000.0_f32 / 125.0_f32).powf(norm);
                let fft_bin = ((freq * VIZ_FFT_SIZE as f32 / VIZ_SAMPLE_RATE as f32).round() as usize)
                    .min(VIZ_FFT_SIZE / 2);
                let c = &spectrum[fft_bin];
                let mag = (c.r * c.r + c.i * c.i).sqrt() / VIZ_FFT_SIZE as f32;
                let db = 20.0 * mag.max(1.0e-9).log10();
                let value = (((db + 90.0) / 70.0).clamp(0.0, 1.0) * 255.0).round() as u8;
                bytes.push(value);
            }
            encoded_columns.push(base64_encode(&bytes));
        }
        unsafe { free(cfg) };

        let mut json = String::new();
        write!(
            &mut json,
            "{{\"type\":\"plate\",\"sr\":{},\"in_db\":{:.2},\"out_db\":{:.2},\"columns\":{},\"bins\":{},\"data\":[",
            VIZ_SAMPLE_RATE, self.input_db, self.output_db, VIZ_COLUMNS, VIZ_BINS
        )
        .unwrap();
        for (i, column) in encoded_columns.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            write!(&mut json, "\"{}\"", column).unwrap();
        }
        json.push_str("]}");
        self.viz_json = json;
        self.viz_dirty = false;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_create(sample_rate: i32) -> *mut DragonflyPlateEngine {
    Box::into_raw(Box::new(DragonflyPlateEngine::new(sample_rate)))
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_destroy(engine: *mut DragonflyPlateEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_set_sample_rate(engine: *mut DragonflyPlateEngine, sample_rate: i32, _max_block: i32) {
    let engine = unsafe { &mut *engine };
    unsafe { dragonfly_plate_set_sample_rate(engine.dsp, sample_rate) };
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_set_parameter(engine: *mut DragonflyPlateEngine, index: u32, value: f32) {
    let engine = unsafe { &mut *engine };
    let idx = index as usize;
    if idx < PARAM_COUNT {
        let clamped = clamp_param(idx, value);
        if (engine.params[idx] - clamped).abs() > 1.0e-6 {
            engine.params[idx] = clamped;
            engine.viz_dirty = true;
        }
        unsafe {
            dragonfly_plate_set_parameter(engine.dsp, index, clamped);
            dragonfly_plate_set_parameter(engine.viz_dsp, index, clamped);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_process(
    engine: *mut DragonflyPlateEngine,
    in_l: *const f32,
    in_r: *const f32,
    out_l: *mut f32,
    out_r: *mut f32,
    frames: u32,
) {
    let engine = unsafe { &mut *engine };
    let n = frames as usize;
    let input_l = unsafe { std::slice::from_raw_parts(in_l, n) };
    let input_r = unsafe { std::slice::from_raw_parts(in_r, n) };
    let peak_in = input_l
        .iter()
        .chain(input_r.iter())
        .fold(0.0f32, |peak, sample| peak.max(sample.abs()));
    unsafe { dragonfly_plate_process(engine.dsp, in_l, in_r, out_l, out_r, frames) };
    let output_l = unsafe { std::slice::from_raw_parts(out_l, n) };
    let output_r = unsafe { std::slice::from_raw_parts(out_r, n) };
    let peak_out = output_l
        .iter()
        .chain(output_r.iter())
        .fold(0.0f32, |peak, sample| peak.max(sample.abs()));
    engine.input_db = db_from_peak(peak_in);
    engine.output_db = db_from_peak(peak_out);
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_clear_buffers(engine: *mut DragonflyPlateEngine) {
    let engine = unsafe { &mut *engine };
    unsafe {
        dragonfly_plate_clear_buffers(engine.dsp);
        dragonfly_plate_clear_buffers(engine.viz_dsp);
    }
    engine.viz_dirty = true;
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_get_state(engine: *mut DragonflyPlateEngine, buffer: *mut u8, buffer_size: u32) -> u32 {
    let engine = unsafe { &*engine };
    let required = PARAM_COUNT * 4;
    if buffer.is_null() || (buffer_size as usize) < required {
        return required as u32;
    }
    let dest = unsafe { std::slice::from_raw_parts_mut(buffer, required) };
    for i in 0..PARAM_COUNT {
        dest[i * 4..(i + 1) * 4].copy_from_slice(&engine.params[i].to_le_bytes());
    }
    required as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_set_state(engine: *mut DragonflyPlateEngine, buffer: *const u8, size: u32) {
    let engine = unsafe { &mut *engine };
    let required = PARAM_COUNT * 4;
    if buffer.is_null() || (size as usize) < required {
        return;
    }
    let src = unsafe { std::slice::from_raw_parts(buffer, required) };
    for i in 0..PARAM_COUNT {
        let value = f32::from_le_bytes(src[i * 4..(i + 1) * 4].try_into().unwrap());
        let clamped = clamp_param(i, value);
        engine.params[i] = clamped;
        unsafe {
            dragonfly_plate_set_parameter(engine.dsp, i as u32, clamped);
            dragonfly_plate_set_parameter(engine.viz_dsp, i as u32, clamped);
        }
    }
    engine.viz_dirty = true;
}

#[unsafe(no_mangle)]
pub extern "C" fn dfplate_get_viz_json(engine: *mut DragonflyPlateEngine, buffer: *mut u8, buffer_size: u32) -> u32 {
    let engine = unsafe { &mut *engine };
    if engine.viz_dirty || engine.viz_json.is_empty() {
        engine.render_viz();
    }
    let bytes = engine.viz_json.as_bytes();
    let required = bytes.len() + 1;
    if buffer.is_null() || (buffer_size as usize) < required {
        return required as u32;
    }
    let dest = unsafe { std::slice::from_raw_parts_mut(buffer, required) };
    dest[..bytes.len()].copy_from_slice(bytes);
    dest[bytes.len()] = 0;
    required as u32
}
