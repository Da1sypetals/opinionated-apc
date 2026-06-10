var resp1dec = function(x) { return Math.pow(10, x) * (10/9*0.1) - (10/9*0.1); };
var resp2dec = function(x) { return Math.pow(10, 2*x) * (100/99*0.01) - (100/99*0.01); };
var resp3dec = function(x) { return Math.pow(10, 3*x) * (1000/999*0.001) - (1000/999*0.001); };
var resp3oct = function(x) { return Math.pow(2, 3*x) * (8/7*0.125) - (8/7*0.125); };
var resp4oct = function(x) { return Math.pow(2, 4*x) * (16/15*0.0625) - (16/15*0.0625); };

export function fmt(id, v) {
    switch (id) {
        case "input_mix": case "early_diffuse_feedback": case "tap_decay":
        case "late_diffuse_feedback": case "eq_cross_seed":
            return Math.round(v * 100) + "%";
        case "early_diffuse_mod_amount": case "late_line_mod_amount": case "late_diffuse_mod_amount":
            return Math.round(v * 250) + "%";
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
            return s < 1 ? Math.round(s * 1000) + " ms" : s < 10 ? s.toFixed(2) + " s" : s.toFixed(1) + " s";
        case "early_diffuse_mod_rate": case "late_line_mod_rate": case "late_diffuse_mod_rate":
            return (resp2dec(v) * 5).toFixed(2) + " Hz";
        case "seed_tap": case "seed_diffusion": case "seed_delay": case "seed_post_diffusion":
            return ("000" + Math.floor(v * 999)).slice(-3);
        default: return Math.round(v * 100) + "%";
    }
}
