use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    // Windows: copy the libmpv DLLs (downloaded by scripts/setup-libmpv.mjs)
    // next to the dev binary so the mpv player engine can load them.
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" {
        return;
    }
    let lib_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("lib");
    println!("cargo:rerun-if-changed={}", lib_dir.display());
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default());
    // OUT_DIR is target/<profile>/build/<crate>/out; walk up to target/<profile>.
    let Some(profile_dir) = out_dir.ancestors().nth(3) else {
        return;
    };

    for lib_name in ["libmpv-wrapper.dll", "libmpv-2.dll"] {
        let src = lib_dir.join(lib_name);
        let dst = profile_dir.join(lib_name);
        let size = |path: &PathBuf| fs::metadata(path).ok().map(|m| m.len());
        if src.exists() && size(&src) != size(&dst) {
            let _ = fs::copy(&src, &dst);
        }
    }
}
