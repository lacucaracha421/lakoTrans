use std::path::Path;
use anyhow::Result;
use candle_core::{DType, Device};
use candle_nn::VarBuilder;
pub fn model_dtype(device: &Device) -> DType { crate::ops::model_dtype(device) }
pub fn load_mmaped_safetensors_path_with_dtype<T, Build, E>(
    weights: &Path,
    device: &Device,
    dtype: DType,
    build: Build,
) -> Result<T>
where
    Build: FnOnce(VarBuilder) -> std::result::Result<T, E>,
    E: Into<anyhow::Error>,
{
    let vb = unsafe { VarBuilder::from_mmaped_safetensors(&[weights], dtype, device)? };
    build(vb).map_err(Into::into)
}

