use std::path::Path;

fn main() {
    let shared = Path::new("../../../shared/dragonfly-freeverb");
    let mut build = cc::Build::new();
    build.cpp(true);
    build.flag_if_supported("-std=c++14");
    build.flag_if_supported("-mmacosx-version-min=15.0");
    build.define("LIBFV3_FLOAT", None);
    build.include("cpp");
    build.include(shared);
    build.include(shared.join("freeverb"));
    build.file("cpp/DSP.cpp");
    build.file("cpp/dsp_wrapper.cpp");

    for file in [
        "allpass.cpp",
        "biquad.cpp",
        "comb.cpp",
        "delay.cpp",
        "delayline.cpp",
        "earlyref.cpp",
        "efilter.cpp",
        "nrev.cpp",
        "nrevb.cpp",
        "progenitor.cpp",
        "progenitor2.cpp",
        "revbase.cpp",
        "slot.cpp",
        "strev.cpp",
        "utils.cpp",
        "zrev.cpp",
        "zrev2.cpp",
    ] {
        build.file(shared.join("freeverb").join(file));
    }

    build.compile("dragonfly_hall_cpp");

    let mut kiss = cc::Build::new();
    kiss.include(shared.join("kiss_fft"));
    kiss.flag_if_supported("-mmacosx-version-min=15.0");
    kiss.file(shared.join("kiss_fft/kiss_fft.c"));
    kiss.file(shared.join("kiss_fft/kiss_fftr.c"));
    kiss.compile("dragonfly_hall_kiss");
}
