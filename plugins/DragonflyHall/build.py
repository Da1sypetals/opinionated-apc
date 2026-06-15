import argparse
import os
import plistlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
BUILD_DIR = ROOT / "build"
PLUGIN_NAME = "DragonflyHall"
PLUGIN_CODE = "DHll"
MANUFACTURER_CODE = "Awin"
AU_COMPONENT = BUILD_DIR / f"plugins/{PLUGIN_NAME}/{PLUGIN_NAME}_artefacts/Release/AU/Dragonfly Hall.component"
STANDALONE_APP = BUILD_DIR / f"plugins/{PLUGIN_NAME}/{PLUGIN_NAME}_artefacts/Release/Standalone/Dragonfly Hall.app"
INSTALL_DIR = Path.home() / "Library/Audio/Plug-Ins/Components"
LOGIC_PREF = Path.home() / "Library/Preferences/com.apple.logic10.plist"
AUDIO_COMPONENT_CACHE = Path.home() / "Library/Preferences/com.apple.audio.AudioComponentCache.plist"
AU_CACHE_DIR = Path.home() / "Library/Caches/AudioUnitCache"

def nproc():
    return os.cpu_count() or 4

def run(cmd, **kwargs):
    print(f"$ {' '.join(str(c) for c in cmd)}")
    subprocess.run(cmd, check=True, **kwargs)

def process_exists(name):
    result = subprocess.run(["pgrep", "-x", name], capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result.returncode == 0

def remove_existing(path):
    if path.exists():
        run(["rm", "-rf", str(path)])
    else:
        print(f"Skip missing path: {path}")

def logic_cache_key_exists():
    if not LOGIC_PREF.exists():
        return False
    with LOGIC_PREF.open("rb") as f:
        prefs = plistlib.load(f)
    return f"aufx-{PLUGIN_CODE}-{MANUFACTURER_CODE}" in prefs

def do_build(standalone_only=False, au_only=False):
    BUILD_DIR.mkdir(exist_ok=True)
    run(["cmake", "-B", str(BUILD_DIR),
         "-DCMAKE_BUILD_TYPE=Release",
         "-DCMAKE_OSX_ARCHITECTURES=arm64",
         "-DAPC_BUILD_ONLY_CLOUDSEED=OFF",
         "-DAPC_BUILD_ONLY_DEBESS=OFF",
         "-DAPC_BUILD_ONLY_ZLCOMP=OFF",
         "-DAPC_BUILD_ONLY_DRAGONFLY_PLATE=OFF",
         "-DAPC_BUILD_ONLY_DRAGONFLY_HALL=ON"],
        cwd=str(ROOT))

    targets = []
    if not standalone_only:
        targets.append(f"{PLUGIN_NAME}_AU")
    if not au_only:
        targets.append(f"{PLUGIN_NAME}_Standalone")

    for target in targets:
        run(["cmake", "--build", str(BUILD_DIR), "--target", target, "--config", "Release", f"-j{nproc()}"])

    print("\nBuild complete.")
    print(f"  AU: {AU_COMPONENT}")
    print(f"  Standalone: {STANDALONE_APP}")

def do_install():
    if not AU_COMPONENT.exists():
        print("AU component not found. Run build first.")
        sys.exit(1)
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    dest = INSTALL_DIR / AU_COMPONENT.name
    remove_existing(dest)
    run(["cp", "-R", str(AU_COMPONENT), str(dest)])
    print(f"\nInstalled to {dest}")

def do_clear():
    if process_exists("AudioComponentRegistrar"):
        run(["killall", "-9", "AudioComponentRegistrar"])
    else:
        print("Skip stopped process: AudioComponentRegistrar")

    if logic_cache_key_exists():
        run(["defaults", "delete", "com.apple.logic10", f"aufx-{PLUGIN_CODE}-{MANUFACTURER_CODE}"])
    else:
        print(f"Skip missing Logic AU cache key: aufx-{PLUGIN_CODE}-{MANUFACTURER_CODE}")

    remove_existing(AUDIO_COMPONENT_CACHE)
    remove_existing(AU_CACHE_DIR)
    print("\nCaches cleared. Restart Logic Pro to rescan.")

def do_validate():
    print("Running auval...")
    run(["auval", "-v", "aufx", PLUGIN_CODE, MANUFACTURER_CODE])

def cmd_build(args):
    do_build(standalone_only=args.standalone, au_only=args.au_only)

def cmd_install(args):
    do_install()

def cmd_clear(args):
    do_clear()

def cmd_validate(args):
    do_validate()

def cmd_all(args):
    do_build(au_only=True)
    do_install()
    do_clear()
    do_validate()

def main():
    parser = argparse.ArgumentParser(description="Build/install/validate Dragonfly Hall")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_build = sub.add_parser("build", help="Build plugin")
    p_build.add_argument("--standalone", action="store_true", help="Build Standalone only")
    p_build.add_argument("--au-only", action="store_true", help="Build AU only")
    p_build.set_defaults(func=cmd_build)

    sub.add_parser("install", help="Install AU to system plugin directory").set_defaults(func=cmd_install)
    sub.add_parser("clear", help="Clear AU caches").set_defaults(func=cmd_clear)
    sub.add_parser("validate", help="Run auval validation").set_defaults(func=cmd_validate)
    sub.add_parser("all", help="Build AU -> install -> clear caches -> validate").set_defaults(func=cmd_all)

    args = parser.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
