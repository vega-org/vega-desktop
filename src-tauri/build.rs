use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    // Auto-copy libmpv dynamic libraries next to the output binary so they can be loaded at runtime (Windows, macOS & Linux)
    if target_os == "windows" || target_os == "macos" || target_os == "linux" {
        let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default());
        // OUT_DIR is deep in target/debug/build/..., walk up to target/debug/
        if let Some(target_debug) = out_dir.ancestors().find(|p| {
            p.file_name()
                .map(|n| n == "debug" || n == "release")
                .unwrap_or(false)
        }) {
            let lib_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("lib");

            let libs = if target_os == "windows" {
                vec!["libmpv-wrapper.dll", "libmpv-2.dll"]
            } else if target_os == "macos" {
                // On macOS, developers might name it libmpv.dylib or libmpv.2.dylib
                vec!["libmpv-wrapper.dylib", "libmpv.dylib", "libmpv.2.dylib"]
            } else {
                vec!["libmpv-wrapper.so", "libmpv.so", "libmpv.so.2"]
            };

            for lib_name in libs {
                let src = lib_dir.join(lib_name);
                let dst = target_debug.join(lib_name);
                if src.exists()
                    && (!dst.exists()
                        || fs::metadata(&src).ok().map(|m| m.len())
                            != fs::metadata(&dst).ok().map(|m| m.len()))
                {
                    let _ = fs::copy(&src, &dst);
                    println!(
                        "cargo:warning=Copied {} to {}",
                        lib_name,
                        target_debug.display()
                    );
                }
            }
        }
    }
}
