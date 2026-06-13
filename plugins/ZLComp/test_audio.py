import subprocess
import wave
import struct
import math
import os
import sys

# 用 aupval（apple AU processing tool）不行，用 afconvert 来通过 AU 处理音频
# 实际上用 aurender 来处理

# 方案：用 JUCE standalone 的命令行，但它不支持。
# 换个方案：写一个最小 Rust 程序直接调 FFI 来处理真实音频文件

INPUT = "/Users/daisy/develop/audio-plugin-coder/audio/chichi.mp3"
RUST_DIR = "/Users/daisy/develop/audio-plugin-coder/rust-dsp-crates/compressor/zlcompressor-rs"

# 跑 compare_cpp（使用真实音频），检查输出是否有 clipping
os.chdir(RUST_DIR)
result = subprocess.run(
    ["cargo", "run", "--release", "--example", "compare_output"],
    capture_output=True, text=True
)
print(result.stdout)
if result.returncode != 0:
    print("STDERR:", result.stderr)
    sys.exit(1)

# 额外检查：生成 WAV 输出并用 ffmpeg 分析峰值
result2 = subprocess.run(
    ["cargo", "run", "--release", "--example", "compare_cpp"],
    capture_output=True, text=True
)
print(result2.stdout)
