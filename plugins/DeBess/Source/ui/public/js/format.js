// 参数显示格式化：把归一化值 0..1 转成可读文本
// 数值映射需与 Rust kernel.rs 保持一致（RANGE_MAX_DB / FREQ_MIN / FREQ_MAX）

const RANGE_MAX_DB = 36;
const FREQ_MIN = 2000;
const FREQ_MAX = 16000;

const LABELS = {
    intensity: 'Amount',
    sharpness: 'Sharpness',
    depth: 'Range',
    filter: 'Frequency',
    sense_mon: 'Listen',
};

export function fmtLabel(pid) {
    return LABELS[pid] || pid;
}

export function fmt(pid, norm) {
    if (pid === 'depth') {
        const db = norm * RANGE_MAX_DB;
        return db < 0.05 ? 'OFF' : '-' + db.toFixed(1) + ' dB';
    }
    if (pid === 'filter') {
        const fc = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, norm);
        return (fc / 1000).toFixed(fc >= 10000 ? 1 : 2) + ' kHz';
    }
    return Math.round(norm * 100) + '%';
}

// 面向"音频结果"的英文说明（描述旋钮带来的听感变化，而非技术实现）
const DESC = {
    intensity: 'Overall de-essing strength — how aggressively harsh "ess" and "sh" sounds are detected and tamed.',
    sharpness: 'How selective the effect is — higher catches only the sharpest, fastest sibilant peaks and reacts more smoothly.',
    depth: 'The most sibilance can be turned down — higher removes more, lower keeps the reduction subtle and natural.',
    filter: 'The frequency above which sound is treated as sibilance — raise it to target only the sharpest highs, lower it to catch a wider band.',
    sense_mon: 'Hear only the sibilance being removed, so you can dial in the frequency and amount precisely.',
};

export function fmtDesc(pid) {
    return DESC[pid] || '';
}
