fn main() {
    println!("cargo:rerun-if-changed=windows.manifest");
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        if std::env::var_os("CARGO_FEATURE_CUDA").is_some() {
            // Candle 0.11 links these imports. CPU/LibTorch/ROCm workers must
            // start without an installed CUDA SDK or NVIDIA driver. AnimeText
            // explicitly prepares its CUDA/ZLUDA libraries before using them.
            println!("cargo:rustc-link-lib=delayimp");
            for library in ["nvcuda.dll", "curand64_10.dll", "cublas64_12.dll", "cudart64_12.dll"] {
                println!("cargo:rustc-link-arg-bin=mgt-koharu-inpaint-runner=/DELAYLOAD:{library}");
            }
        }
        let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
            .join("windows.manifest");
        println!("cargo:rustc-link-arg-bin=mgt-koharu-inpaint-runner=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-bin=mgt-koharu-inpaint-runner=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
