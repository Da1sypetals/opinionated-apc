// 参数显示格式化：把归一化值 0..1 转成可读文本

const LABELS = {
    intensity: 'Intensity',
    sharpness: 'Sharpness',
    depth: 'Depth',
    filter: 'Filter',
    sense_mon: 'Sense Mon',
};

export function fmtLabel(pid) {
    return LABELS[pid] || pid;
}

export function fmt(pid, norm) {
    return Math.round(norm * 100) + '%';
}
