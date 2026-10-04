use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use serde::Deserialize;

/// Written by the app after checksum-verified installation. A worker never
/// discovers, downloads, or substitutes a runtime on its own.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeRuntime {
    pub schema: u32,
    pub engine: String,
    pub backend: String,
    pub libraries: Vec<PathBuf>,
}

pub struct LoadedRuntime {
    pub specification: NativeRuntime,
    _libraries: Vec<libloading::Library>,
}

pub fn load_runtime(manifest: &Path, expected_engine: &str) -> Result<LoadedRuntime> {
    let specification: NativeRuntime = serde_json::from_slice(
        &std::fs::read(manifest).with_context(|| format!("read {}", manifest.display()))?,
    )?;
    validate_specification(&specification, expected_engine)?;
    let mut libraries = Vec::with_capacity(specification.libraries.len());
    for path in &specification.libraries {
        let path = path
            .canonicalize()
            .with_context(|| format!("missing runtime library {}", path.display()))?;
        // Keep handles alive for the entire worker/model lifetime.
        libraries.push(
            unsafe { open_library(&path) }
                .with_context(|| format!("load native runtime library {}", path.display()))?,
        );
    }
    Ok(LoadedRuntime {
        specification,
        _libraries: libraries,
    })
}

fn validate_specification(spec: &NativeRuntime, expected_engine: &str) -> Result<()> {
    ensure!(
        spec.schema == 1,
        "unsupported native runtime manifest schema"
    );
    ensure!(
        spec.engine == expected_engine,
        "native runtime engine mismatch"
    );
    ensure!(
        matches!(spec.backend.as_str(), "cpu" | "cuda" | "rocm" | "metal"),
        "unsupported native runtime backend"
    );
    ensure!(
        !spec.libraries.is_empty() && spec.libraries.len() <= 128,
        "invalid native runtime library count"
    );
    ensure!(
        spec.libraries.iter().all(|path| path.is_absolute()),
        "native runtime libraries must use absolute paths"
    );
    Ok(())
}

/// Explicit command, executed before model CLI parsing. It uses only the
/// app-installed ROCm core; no system SDK discovery or model downloads.
pub fn handle_rocm_probe() -> Result<bool> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|arg| arg != "--probe-rocm") {
        return Ok(false);
    }
    ensure!(args.len() == 4, "usage: --probe-rocm MANIFEST GPU_INDEX");
    let index: i32 = args[3].to_str().context("invalid GPU index")?.parse()?;
    let runtime = load_runtime(Path::new(&args[2]), "rocm-probe")?;
    ensure!(
        runtime.specification.backend == "rocm",
        "ROCm probe backend mismatch"
    );
    let position = runtime
        .specification
        .libraries
        .iter()
        .position(|path| {
            path.file_name()
                .is_some_and(|name| name == "amdhip64_7.dll")
        })
        .context("ROCm core manifest omits amdhip64_7.dll")?;
    let library = &runtime._libraries[position];
    type GetCount = unsafe extern "C" fn(*mut i32) -> i32;
    type GetProperties = unsafe extern "C" fn(*mut std::ffi::c_void, i32) -> i32;
    let get_count = unsafe { *library.get::<GetCount>(b"hipGetDeviceCount\0")? };
    let get_properties =
        unsafe { *library.get::<GetProperties>(b"hipGetDevicePropertiesR0600\0")? };
    let mut count = 0;
    let status = unsafe { get_count(&mut count) };
    ensure!(
        status == 0 && (1..=128).contains(&count),
        "ROCm reported status {status}, devices {count}"
    );
    ensure!(
        (0..count).contains(&index),
        "ROCm GPU index {index} is unavailable ({count} devices)"
    );
    // Same ABI-tolerant aligned buffer used by Koharu 0.83.5's ROCm probe.
    #[repr(C, align(64))]
    struct Properties([u8; 64 * 1024]);
    let mut properties = Box::new(Properties([0; 64 * 1024]));
    let status = unsafe { get_properties(properties.0.as_mut_ptr().cast(), index) };
    ensure!(status == 0, "ROCm device properties failed: {status}");
    let target =
        parse_rocm_target(&properties.0).context("ROCm did not report an exact gfx target")?;
    println!(
        "{}",
        serde_json::json!({"schema":1,"gpu_index":index,"target":target})
    );
    Ok(true)
}

fn parse_rocm_target(properties: &[u8]) -> Option<&str> {
    properties
        .windows(3)
        .enumerate()
        .find_map(|(start, bytes)| {
            if bytes != b"gfx" {
                return None;
            }
            let suffix = properties[start + 3..]
                .iter()
                .take_while(|byte| byte.is_ascii_alphanumeric())
                .count();
            let target = std::str::from_utf8(&properties[start..start + 3 + suffix]).ok()?;
            let suffix = &target[3..];
            (!suffix.is_empty()
                && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
                && suffix.bytes().any(|byte| byte.is_ascii_digit()))
            .then_some(target)
        })
}

#[cfg(windows)]
unsafe fn open_library(path: &Path) -> Result<libloading::Library, libloading::Error> {
    use libloading::os::windows::{
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32, Library,
    };
    unsafe {
        Library::load_with_flags(
            path,
            LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
        )
        .map(Into::into)
    }
}

#[cfg(not(windows))]
unsafe fn open_library(path: &Path) -> Result<libloading::Library, libloading::Error> {
    use libloading::os::unix::{Library, RTLD_LAZY, RTLD_LOCAL};
    unsafe { Library::open(Some(path), RTLD_LAZY | RTLD_LOCAL).map(Into::into) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognizes_exact_rocm_target_without_accepting_grouped_names() {
        assert_eq!(
            parse_rocm_target(b"noise gfx1100:xnack-\0"),
            Some("gfx1100")
        );
        assert_eq!(parse_rocm_target(b"gfx90a\0"), Some("gfx90a"));
        assert_eq!(parse_rocm_target(b"gfx110X\0 gfx1201\0"), Some("gfx1201"));
        assert_eq!(parse_rocm_target(b"gfx\0"), None);
    }
    fn specification() -> NativeRuntime {
        NativeRuntime {
            schema: 1,
            engine: "torch".into(),
            backend: "cpu".into(),
            libraries: vec![std::env::current_exe().unwrap()],
        }
    }
    #[test]
    fn rejects_mismatched_engine_schema_backend_and_relative_paths() {
        let mut spec = specification();
        assert!(validate_specification(&spec, "torch").is_ok());
        assert!(validate_specification(&spec, "diffusion").is_err());
        spec.schema = 2;
        assert!(validate_specification(&spec, "torch").is_err());
        spec.schema = 1;
        spec.backend = "auto".into();
        assert!(validate_specification(&spec, "torch").is_err());
        spec.backend = "cpu".into();
        spec.libraries = vec!["relative.dll".into()];
        assert!(validate_specification(&spec, "torch").is_err());
        spec.libraries.clear();
        assert!(validate_specification(&spec, "torch").is_err());
    }
}
