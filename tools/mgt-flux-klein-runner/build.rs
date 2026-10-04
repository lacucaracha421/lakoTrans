fn main() {
    println!("cargo:rerun-if-changed=windows.manifest");
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
            .join("windows.manifest");
        println!("cargo:rustc-link-arg-bin=mgt-flux-klein=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-bin=mgt-flux-klein=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
