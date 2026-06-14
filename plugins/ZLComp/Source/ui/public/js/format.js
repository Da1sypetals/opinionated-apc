// 参数格式化：归一化 0-1 → 实际值显示
// 缩放逻辑必须与 Rust params.rs 一致

function linearMid(v, min, max, mid) {
    if (v < 0.5) return min + (v * 2) * (mid - min);
    return mid + ((v - 0.5) * 2) * (max - mid);
}

function logMid(v, xMin, xMax, xMid, shift) {
    const rng1 = Math.log(xMid / xMin) * 2;
    const rng2 = Math.log(xMax / xMid) * 2;
    let raw;
    if (v < 0.5) raw = Math.exp(v * rng1) * xMin;
    else raw = Math.exp((v - 0.5) * rng2) * xMid;
    return raw + shift;
}

function reversedLogMid(v, xMin, xMax, xMid, shift) {
    return -logMid(1 - v, xMin, xMax, xMid, shift);
}

function skew(v, min, max, s) {
    return min + (max - min) * Math.pow(v, 1 / s);
}

const STYLES = ['CLEAN', 'CLASSIC', 'OPTICAL', 'VOCAL'];

export function denormalize(pid, norm) {
    const v = Math.max(0, Math.min(1, norm));
    switch (pid) {
        case 'threshold': return reversedLogMid(v, 1, 61, 33, -1);
        case 'ratio':     return logMid(v, 1, 100, 3, 0);
        case 'knee':      return skew(v, 0, 32, 0.5);
        case 'attack':    return logMid(v, 20, 1020, 120, -20);
        case 'release':   return logMid(v, 100, 5100, 600, -100);
        case 'pump':      return v * 100;
        case 'smooth':    return v * 100;
        case 'hold':      return logMid(v, 20, 1020, 120, -20);
        case 'range':     return linearMid(v, 0, 80, 18);
        case 'makeup':    return -30 + v * 60;
        case 'wet':       return v * 100;
        case 'lookahead': return logMid(v, 2, 22, 7, -2);
        case 'rms_length': return logMid(v, 4, 164, 36, -4);
        case 'rms_speed': return logMid(v, 1, 9, 2, -1);
        case 'rms_mix':   return v * 100;
        case 'style':     return Math.round(v * 3);
        default:          return v;
    }
}

export function fmt(pid, norm) {
    const val = denormalize(pid, norm);
    switch (pid) {
        case 'threshold': return val.toFixed(1) + ' dB';
        case 'ratio':     return val >= 99.5 ? 'inf:1' : val.toFixed(1) + ':1';
        case 'knee':      return val.toFixed(1) + ' dB';
        case 'attack':    return val < 10 ? val.toFixed(1) + ' ms' : Math.round(val) + ' ms';
        case 'release':   return val < 10 ? val.toFixed(1) + ' ms' : Math.round(val) + ' ms';
        case 'pump':      return Math.round(val) + '%';
        case 'smooth':    return Math.round(val) + '%';
        case 'hold':      return val < 10 ? val.toFixed(1) + ' ms' : Math.round(val) + ' ms';
        case 'range':     return val.toFixed(1) + ' dB';
        case 'makeup':    return (val >= 0 ? '+' : '') + val.toFixed(1) + ' dB';
        case 'wet':       return Math.round(val) + '%';
        case 'lookahead': return val.toFixed(1) + ' ms';
        case 'rms_length': return val < 10 ? val.toFixed(1) + ' ms' : Math.round(val) + ' ms';
        case 'rms_speed': return val.toFixed(1) + '×';
        case 'rms_mix':   return Math.round(val) + '%';
        case 'style':     return STYLES[Math.round(val)] || 'CLEAN';
        default:          return Math.round(norm * 100) + '%';
    }
}

export function fmtLabel(pid) {
    const LABELS = {
        threshold: 'THRESH', ratio: 'RATIO', knee: 'KNEE',
        attack: 'ATTACK', release: 'RELEASE',
        pump: 'PUMP', smooth: 'SMOOTH', hold: 'HOLD',
        range: 'RANGE', makeup: 'MAKEUP', wet: 'WET',
        lookahead: 'LOOK', rms_length: 'LEN', rms_speed: 'SPD', rms_mix: 'MIX',
        style: 'STYLE',
    };
    return LABELS[pid] || pid.toUpperCase();
}
