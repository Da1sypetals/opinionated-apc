#!/usr/bin/env python3
import argparse
import subprocess
import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
BUILD_DIR = ROOT / "build"
PLUGIN_NAME = "CloudSeed"
AU_COMPONENT = BUILD_DIR / f"plugins/{PLUGIN_NAME}/{PLUGIN_NAME}_artefacts/Release/AU/{PLUGIN_NAME}.component"
STANDALONE_APP = BUILD_DIR / f"plugins/{PLUGIN_NAME}/{PLUGIN_NAME}_artefacts/Release/Standalone/{PLUGIN_NAME}.app"
INSTALL_DIR = Path.home() / "Library/Audio/Plug-Ins/Components"

def nproc():
    return os.cpu_count() or 4

def run(cmd, **kwargs):
    print(f"$ {' '.join(str(c) for c in cmd)}")
    subprocess.run(cmd, check=True, **kwargs)

def do_build(standalone_only=False, au_only=False):
    BUILD_DIR.mkdir(exist_ok=True)
    run(["cmake", "-B", str(BUILD_DIR),
         "-DCMAKE_BUILD_TYPE=Release",
         "-DCMAKE_OSX_ARCHITECTURES=arm64"],
        cwd=str(ROOT))

    targets = []
    if standalone_only:
        targets.append(f"{PLUGIN_NAME}_Standalone")
    elif au_only:
        targets.append(f"{PLUGIN_NAME}_AU")
    else:
        targets.append(f"{PLUGIN_NAME}_AU")
        targets.append(f"{PLUGIN_NAME}_Standalone")

    for t in targets:
        run(["cmake", "--build", str(BUILD_DIR),
             "--target", t, "--config", "Release",
             f"-j{nproc()}"])

    print(f"\nBuild complete.")
    if AU_COMPONENT.exists():
        print(f"  AU: {AU_COMPONENT}")
    if STANDALONE_APP.exists():
        print(f"  Standalone: {STANDALONE_APP}")

def do_install():
    dest = INSTALL_DIR / f"{PLUGIN_NAME}.component"
    if not AU_COMPONENT.exists():
        print(f"ERROR: AU not found at {AU_COMPONENT}")
        print("Run `build` first.")
        sys.exit(1)
    run(["rm", "-rf", str(dest)])
    run(["cp", "-R", str(AU_COMPONENT), str(dest)])
    print(f"\nInstalled to {dest}")

def do_clear():
    subprocess.run(["killall", "-9", "AudioComponentRegistrar"])
    subprocess.run(["defaults", "delete", "com.apple.logic10", "aufx-CSed-Nfld"])
    subprocess.run(["rm", "-f", str(Path.home() / "Library/Preferences/com.apple.audio.AudioComponentCache.plist")])
    subprocess.run(["rm", "-rf", str(Path.home() / "Library/Caches/AudioUnitCache")])
    print("\nCaches cleared. Restart Logic Pro to rescan.")

def do_validate():
    print("Running auval...")
    ret = subprocess.run(["auval", "-v", "aufx", "CSed", "Nfld"])
    if ret.returncode != 0:
        sys.exit(1)

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
    parser = argparse.ArgumentParser(description=f"{PLUGIN_NAME} build tool")
    sub = parser.add_subparsers(dest="command", required=True)

    b = sub.add_parser("build", help="Build the plugin")
    b.add_argument("--au-only", action="store_true", help="Build AU only")
    b.add_argument("--standalone", action="store_true", help="Build Standalone only")
    b.set_defaults(func=cmd_build)

    sub.add_parser("install", help="Install AU to system plugin directory").set_defaults(func=cmd_install)
    sub.add_parser("clear", help="Clear AU caches (system + Logic Pro)").set_defaults(func=cmd_clear)
    sub.add_parser("validate", help="Run auval validation").set_defaults(func=cmd_validate)
    sub.add_parser("all", help="Build AU → install → clear caches → validate").set_defaults(func=cmd_all)

    args = parser.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
