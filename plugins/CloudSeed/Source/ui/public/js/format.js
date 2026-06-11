var resp1dec = function(x) { return Math.pow(10, x) * (10/9*0.1) - (10/9*0.1); };
var resp2dec = function(x) { return Math.pow(10, 2*x) * (100/99*0.01) - (100/99*0.01); };
var resp3dec = function(x) { return Math.pow(10, 3*x) * (1000/999*0.001) - (1000/999*0.001); };
var resp3oct = function(x) { return Math.pow(2, 3*x) * (8/7*0.125) - (8/7*0.125); };
var resp4oct = function(x) { return Math.pow(2, 4*x) * (16/15*0.0625) - (16/15*0.0625); };

const LABELS = {
    interpolation: "INTERP", low_cut_enabled: "LOW CUT", high_cut_enabled: "HIGH CUT",
    input_mix: "INPUT MIX", low_cut: "LOW CUT", high_cut: "HIGH CUT",
    dry_out: "DRY", early_out: "EARLY", late_out: "LATE",
    tap_enabled: "TAPS", tap_count: "COUNT", tap_decay: "DECAY",
    tap_predelay: "PRE-DELAY", tap_length: "LENGTH",
    early_diffuse_enabled: "DIFFUSION", early_diffuse_count: "STAGES",
    early_diffuse_delay: "DELAY", early_diffuse_mod_amount: "MOD AMT",
    early_diffuse_feedback: "FEEDBACK", early_diffuse_mod_rate: "MOD RATE",
    late_mode: "MODE", late_line_count: "LINES", late_diffuse_enabled: "DIFFUSION",
    late_diffuse_count: "DIFF STAGES", late_line_size: "SIZE",
    late_line_mod_amount: "MOD AMT", late_diffuse_delay: "DELAY",
    late_diffuse_mod_amount: "DIFF MOD", late_line_decay: "DECAY",
    late_line_mod_rate: "MOD RATE", late_diffuse_feedback: "FEEDBACK",
    late_diffuse_mod_rate: "DIFF RATE",
    eq_low_shelf_enabled: "LOW SHELF", eq_high_shelf_enabled: "HIGH SHELF",
    eq_lowpass_enabled: "LOWPASS", eq_low_freq: "LOW FREQ", eq_high_freq: "HIGH FREQ",
    eq_cutoff: "CUTOFF", eq_low_gain: "LOW GAIN", eq_high_gain: "HIGH GAIN",
    eq_cross_seed: "CROSS SEED",
    seed_tap: "TAP SEED", seed_diffusion: "DIFF SEED",
    seed_delay: "DELAY SEED", seed_post_diffusion: "POST SEED"
};

export function fmtLabel(pid) {
    return LABELS[pid] || pid.toUpperCase();
}

export function fmt(id, v) {
    switch (id) {
        case "input_mix": case "early_diffuse_feedback": case "tap_decay":
        case "late_diffuse_feedback": case "eq_cross_seed":
            return Math.round(v * 100) + "%";
        case "early_diffuse_mod_amount": case "late_line_mod_amount": case "late_diffuse_mod_amount":
            return (v * 2.5).toFixed(2) + " ms";
        case "low_cut": return Math.round(20 + resp4oct(v) * 980) + " Hz";
        case "high_cut": case "eq_high_freq": case "eq_cutoff":
            return Math.round(400 + resp4oct(v) * 19600) + " Hz";
        case "eq_low_freq": return Math.round(20 + resp3oct(v) * 980) + " Hz";
        case "dry_out": case "early_out": case "late_out":
            var db = -30 + v * 30; return db <= -29.9 ? "MUTED" : db.toFixed(1) + " dB";
        case "eq_low_gain": case "eq_high_gain":
            return (-20 + v * 20).toFixed(1) + " dB";
        case "tap_count": return "" + Math.round(1 + v * 255);
        case "early_diffuse_count": return "" + Math.round(1 + v * 11);
        case "late_line_count": return "" + Math.round(1 + v * 11);
        case "late_diffuse_count": return "" + Math.round(1 + v * 7);
        case "tap_predelay": return Math.round(resp1dec(v) * 500) + " ms";
        case "tap_length": return Math.round(10 + v * 990) + " ms";
        case "early_diffuse_delay": return Math.round(10 + v * 90) + " ms";
        case "late_line_size": return Math.round(20 + resp2dec(v) * 980) + " ms";
        case "late_diffuse_delay": return Math.round(10 + v * 90) + " ms";
        case "late_line_decay":
            var s = 0.05 + resp3dec(v) * 59.95;
            return s < 1 ? Math.round(s * 1000) + " ms" : s < 10 ? s.toFixed(2) + " sec" : s.toFixed(1) + " sec";
        case "early_diffuse_mod_rate": case "late_line_mod_rate": case "late_diffuse_mod_rate":
            return (resp2dec(v) * 5).toFixed(2) + " Hz";
        case "seed_tap": case "seed_diffusion": case "seed_delay": case "seed_post_diffusion":
            return ("000" + Math.floor(v * 999)).slice(-3);
        default: return Math.round(v * 100) + "%";
    }
}
