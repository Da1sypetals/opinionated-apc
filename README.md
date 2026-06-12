# Opinionated Audio Plugin Coder (OAPC)

This repo is a fork of [APC](https://github.com/Noizefield/audio-plugin-coder).

The *opinionated* part is:
- Tech stack, where main DSP code is written in Rust, JUCE C++ code only serves as glue, and the UI remains on the web stack, which is tailored for myseld: I have no ability to audio (modern) C++ code, and I would like LLM write 
- Target, we only care about building AUv2 Logic Pro plugin.

If you need to add a rust crate, you will need to add a line that points to `Cargo.toml` in `.vscode/settings.json`:

```json
{
    "rust-analyzer.linkedProjects": [
        "relative/path/to/project/Cargo.toml"
    ]
}
```
