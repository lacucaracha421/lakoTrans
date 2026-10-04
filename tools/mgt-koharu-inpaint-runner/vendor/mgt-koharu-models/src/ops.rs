use candle_core::{DType, Device, Result};
use candle_nn::{Conv2d, Conv2dConfig, VarBuilder};

// Portable sm_75 PTX has no BF16 kernels in upstream Candle 0.11.
// Keep the tiny YOLO detector in F32 on every backend rather than silently
// selecting kernels that the packaged PTX cannot execute.
pub(crate) fn model_dtype(_device: &Device) -> DType { DType::F32 }

pub(crate) fn conv2d(
    in_channels: usize,
    out_channels: usize,
    kernel_size: usize,
    cfg: Conv2dConfig,
    vb: VarBuilder,
) -> Result<Conv2d> {
    maybe_zluda_no_cudnn_conv2d(candle_nn::conv2d(
        in_channels,
        out_channels,
        kernel_size,
        cfg,
        vb,
    )?)
}

pub(crate) fn conv2d_no_bias(
    in_channels: usize,
    out_channels: usize,
    kernel_size: usize,
    cfg: Conv2dConfig,
    vb: VarBuilder,
) -> Result<Conv2d> {
    maybe_zluda_no_cudnn_conv2d(candle_nn::conv2d_no_bias(
        in_channels,
        out_channels,
        kernel_size,
        cfg,
        vb,
    )?)
}

fn maybe_zluda_no_cudnn_conv2d(conv: Conv2d) -> Result<Conv2d> {
    if !crate::zluda_active() {
        return Ok(conv);
    }

    let width = conv.weight().dim(3)?;
    // Candle's CUDA backend selects cuDNN for contiguous kernels. This view preserves the
    // values but makes the kernel layout non-contiguous so ZLUDA uses Candle's CUDA fallback.
    let weight = conv.weight().pad_with_zeros(3, 0, 1)?.narrow(3, 0, width)?;
    Ok(Conv2d::new(weight, conv.bias().cloned(), *conv.config()))
}

