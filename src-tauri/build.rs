use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    // Auto-copy libmpv DLLs next to the output binary so they can be loaded at runtime (Windows only)
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "windows" {
        let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default());
        // OUT_DIR is deep in target/debug/build/..., walk up to target/debug/
        if let Some(target_debug) = out_dir.ancestors().find(|p| {
            p.file_name()
                .map(|n| n == "debug" || n == "release")
                .unwrap_or(false)
        }) {
            let lib_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("lib");
            for dll in &["libmpv-wrapper.dll", "libmpv-2.dll"] {
                let src = lib_dir.join(dll);
                let dst = target_debug.join(dll);
                if src.exists()
                    && (!dst.exists()
                        || fs::metadata(&src).ok().map(|m| m.len())
                            != fs::metadata(&dst).ok().map(|m| m.len()))
                {
                    let _ = fs::copy(&src, &dst);
                    println!("cargo:warning=Copied {} to {}", dll, target_debug.display());
                }
            }
        }
    }
}
