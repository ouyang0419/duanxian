"""Build a debug APK that embeds the phone page."""

from __future__ import annotations

import os
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PHONE = ROOT.parent / "phone"
OUT = ROOT / "build"
KEYSTORE = ROOT / "debug.keystore"


def sdk_root() -> Path:
    for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        value = os.environ.get(key)
        if value:
            return Path(value)
    raise SystemExit("先设置 ANDROID_HOME，指向 Android SDK。")


def java_home() -> Path:
    value = os.environ.get("JAVA_HOME")
    if not value:
        raise SystemExit("先设置 JAVA_HOME，指向 JDK 17。")
    return Path(value)


def build_tools(sdk: Path) -> Path:
    tools = sdk / "build-tools"
    versions = sorted([path for path in tools.iterdir() if path.is_dir()], reverse=True)
    if not versions:
        raise SystemExit(f"{tools} 里没有 build-tools。")
    return versions[0]


def run(args: list[str], **kwargs) -> None:
    print(">", " ".join(str(part) for part in args))
    subprocess.run(args, check=True, **kwargs)


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    classes = OUT / "classes"
    classes.mkdir()
    assets = ROOT / "assets"
    if assets.exists():
        shutil.rmtree(assets)
    assets.mkdir()

    subprocess.run(["node", "build.js"], cwd=PHONE, check=True)
    shutil.copyfile(PHONE / "短线单.html", assets / "index.html")
    subprocess.run(["python", str(ROOT / "make_icon.py")], check=True)

    sdk = sdk_root()
    tools = build_tools(sdk)
    jdk = java_home()
    android_jar = sdk / "platforms" / "android-34" / "android.jar"
    if not android_jar.exists():
        raise SystemExit(f"缺少 {android_jar}")

    aapt2 = tools / "aapt2.exe"
    compiled = OUT / "compiled.zip"
    run([
        str(aapt2), "compile",
        "-o", str(compiled),
        str(ROOT / "res" / "drawable" / "ic_launcher.png"),
    ])
    base = OUT / "base.apk"
    run([
        str(aapt2), "link",
        "-o", str(base),
        "-I", str(android_jar),
        "--manifest", str(ROOT / "AndroidManifest.xml"),
        "-A", str(assets),
        "--min-sdk-version", "26",
        "--target-sdk-version", "34",
        str(compiled),
    ])

    javac = jdk / "bin" / "javac.exe"
    run([
        str(javac),
        "--release", "8",
        "-encoding", "UTF-8",
        "-classpath", str(android_jar),
        "-d", str(classes),
        str(ROOT / "src" / "app" / "duanxian" / "MainActivity.java"),
    ])

    dex_dir = OUT / "dex"
    dex_dir.mkdir()
    class_files = [str(path) for path in classes.rglob("*.class")]
    run([
        str(tools / "d8.bat"),
        "--min-api", "26",
        "--lib", str(android_jar),
        "--output", str(dex_dir),
        *class_files,
    ])

    unsigned = OUT / "unsigned.apk"
    shutil.copyfile(base, unsigned)
    with zipfile.ZipFile(unsigned, "a") as apk:
        apk.write(dex_dir / "classes.dex", "classes.dex")

    aligned = OUT / "aligned.apk"
    run([
        str(tools / "zipalign.exe"),
        "-f", "-p", "4",
        str(unsigned),
        str(aligned),
    ])

    if not KEYSTORE.exists():
        run([
            str(jdk / "bin" / "keytool.exe"),
            "-genkeypair",
            "-keystore", str(KEYSTORE),
            "-storepass", "android",
            "-keypass", "android",
            "-alias", "androiddebugkey",
            "-keyalg", "RSA",
            "-keysize", "2048",
            "-validity", "10000",
            "-dname", "CN=DuanXian, OU=App, O=DuanXian, L=Shanghai, ST=Shanghai, C=CN",
        ])

    signed = ROOT.parent / "短线单.apk"
    run([
        str(tools / "apksigner.bat"),
        "sign",
        "--ks", str(KEYSTORE),
        "--ks-pass", "pass:android",
        "--key-pass", "pass:android",
        "--out", str(signed),
        str(aligned),
    ])
    run([
        str(tools / "apksigner.bat"),
        "verify",
        "--verbose",
        str(signed),
    ])
    print("APK", signed, signed.stat().st_size)


if __name__ == "__main__":
    main()
