pub use runner_image_processing::inpainting;
pub mod lama;
pub mod aot_inpainting;
pub mod anime_text;
pub mod types;
mod backend;
mod loading;
mod ops;
pub use candle_core::Device;

pub fn zluda_active() -> bool { std::env::var("KOHARU_ZLUDA_ACTIVE").as_deref() == Ok("1") }
pub fn device(cpu: bool) -> anyhow::Result<Device> {
    if cpu { return Ok(Device::Cpu); }
    #[cfg(feature="metal")] { return Ok(Device::new_metal(0)?); }
    #[cfg(all(feature="cuda",not(feature="metal")))] { return Ok(Device::new_cuda(0)?); }
    #[cfg(not(any(feature="cuda",feature="metal")))] anyhow::bail!("GPU backend is not compiled into this runner")
}
fn rgb_tensor(image: &image::RgbImage, device: koharu_torch::Device) -> koharu_torch::Tensor {
    koharu_torch::Tensor::from_slice(image.as_raw()).view([1, image.height() as i64, image.width() as i64, 3])
        .permute([0,3,1,2]).to_device(device).to_kind(koharu_torch::Kind::Float)
}
fn mask_tensor(mask: &image::GrayImage, device: koharu_torch::Device) -> koharu_torch::Tensor {
    koharu_torch::Tensor::from_slice(mask.as_raw()).view([1,1,mask.height() as i64,mask.width() as i64])
        .to_device(device).to_kind(koharu_torch::Kind::Float)
}
fn tensor_rgb(output: &koharu_torch::Tensor) -> anyhow::Result<image::RgbImage> {
    let shape=output.size();
    anyhow::ensure!(shape.len()==4 && shape[0]==1 && shape[1]==3,"expected NCHW RGB model output");
    let output=output.clamp(0.0,255.0).to_kind(koharu_torch::Kind::Uint8)
        .to_device(koharu_torch::Device::Cpu).squeeze_dim(0).permute([1,2,0]).contiguous().view([-1]);
    let raw: Vec<u8>=Vec::<u8>::try_from(&output)?;
    image::RgbImage::from_raw(shape[3] as u32,shape[2] as u32,raw)
        .ok_or_else(||anyhow::anyhow!("invalid model image buffer"))
}
