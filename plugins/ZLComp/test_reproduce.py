import subprocess
import wave
import struct
import math
import os

STANDALONE = "/Users/daisy/develop/audio-plugin-coder/build/plugins/ZLComp/ZLComp_artefacts/Release/Standalone/ZLComp.app/Contents/MacOS/ZLComp"
INPUT_WAV = "/tmp/zlcomp_test_input.wav"
OUTPUT_WAV = "/tmp/zlcomp_test_output.wav"

# 生成 3 秒 440Hz 正弦波 -6dBFS stereo，48kHz
sr = 48000
duration = 3
n = sr * duration
amplitude = 0.5

with wave.open(INPUT_WAV, 'w') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(sr)
    for i in range(n):
        s = amplitude * math.sin(2 * math.pi * 440 * i / sr)
        sample = int(s * 32767)
        w.writeframes(struct.pack('<hh', sample, sample))

print(f"Generated {INPUT_WAV}: {n} frames, stereo, 48kHz")

# 用 AU 命令行工具处理（auval 已经证明 render 没问题，
# 但让我们用 afplay 测试真正的音频路径）
# 实际上我们用 Rust 的 FFI 直接处理这个 WAV 来模拟插件行为

# 用 cargo 跑一个实际测试
test_rs = """
use std::process::Command;
fn main() {
    // 读取 WAV，用 FFI 处理，写出 WAV，然后比较峰值
    println!("See compare_cpp example for full comparison");
}
"""

# 直接用已有的 compare_cpp 测试同一文件
result = subprocess.run(
    ["ffmpeg", "-y", "-i", INPUT_WAV, "-ar", "48000", "-ac", "2", "-f", "wav", "/tmp/chichi_input.wav"],
    capture_output=True, text=True
)

os.chdir("/Users/daisy/develop/audio-plugin-coder/rust-dsp-crates/compressor/zlcompressor-rs/reference")
result = subprocess.run(["./reference", "/tmp/chichi_input.wav", "/tmp/cpp_output.wav"], capture_output=True, text=True)
print("C++ reference:", result.stdout.strip())

os.chdir("/Users/daisy/develop/audio-plugin-coder/rust-dsp-crates/compressor/zlcompressor-rs")
result = subprocess.run(["cargo", "run", "--release", "--example", "compare_cpp"], capture_output=True, text=True)
for line in result.stdout.strip().split('\n'):
    print("Rust vs C++:", line)

# 检查 Standalone 是否能正常启动不崩溃
print("\nLaunching Standalone for 2 seconds...")
proc = subprocess.Popen([STANDALONE], stderr=subprocess.PIPE, stdout=subprocess.PIPE)
import time
time.sleep(2)
proc.terminate()
proc.wait(timeout=5)
stderr = proc.stderr.read().decode()
if stderr:
    print(f"STDERR: {stderr}")
else:
    print("Standalone ran without stderr output")
