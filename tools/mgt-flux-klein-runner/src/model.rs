use anyhow::{Context as _, Result, ensure};
use image::{DynamicImage, GenericImageView};
use koharu_diffusion::{
    Context, ContextParams, GuidanceParams, ImageGenerationParams, SampleMethod, SampleParams,
    Scheduler, VaeFormat,
};
use runner_image_processing::{flux::*, inpainting};
use std::{path::PathBuf, sync::Mutex};

const PROMPT: &str = "Clean manga inpainting after lettering removal. The masked area is filled only by the surrounding artwork: blank speech-bubble surface, continuous screentone, paper grain, panel borders, color palette, and line art matching neighboring pixels. Preserve the source page's original color or grayscale style and keep unmasked pixels unchanged.";

pub struct Flux2KleinPaths {
    pub transformer_gguf: PathBuf,
    pub vae_safetensors: PathBuf,
    pub text_encoder_gguf: PathBuf,
}

pub struct Flux2InpaintOptions {
    pub num_inference_steps: usize,
    pub strength: f64,
    pub max_pixels: u32,
    pub mask_padding: u8,
}

pub struct Flux2ImageToImageOptions {
    pub num_inference_steps: usize,
    pub strength: f64,
    pub max_pixels: u32,
}

pub struct Flux2Klein {
    context: Mutex<Context>,
}

impl Flux2Klein {
    pub fn load_from_paths(paths: Flux2KleinPaths, backend: &str) -> Result<Self> {
        let device = match backend {
            "cpu" => "CPU",
            "cuda" => "CUDA0",
            "rocm" => "ROCm0",
            "metal" => "MTL0",
            _ => anyhow::bail!("unsupported FLUX backend"),
        };
        ensure!(
            koharu_diffusion::list_devices()
                .iter()
                .any(|entry| entry.name == device),
            "requested FLUX device {device} is unavailable; CPU fallback is disabled"
        );
        // These component/backend settings follow Koharu 0.83.5's FLUX model
        // assembly. Paths and runtime installation remain owned by the app.
        let context = Context::new(&ContextParams {
            diffusion_model_path: Some(paths.transformer_gguf),
            llm_path: Some(paths.text_encoder_gguf),
            vae_path: Some(paths.vae_safetensors),
            enable_mmap: true,
            flash_attention: backend == "cuda",
            diffusion_flash_attention: backend == "cuda",
            diffusion_conv_direct: backend == "cuda",
            vae_conv_direct: backend == "cuda",
            vae_format: VaeFormat::Flux2,
            backend: Some(device.into()),
            params_backend: (backend != "cpu").then(|| "*=cpu".into()),
            ..ContextParams::default()
        })
        .context("failed to load FLUX.2 Klein components")?;
        ensure!(
            context.supports_image_generation(),
            "FLUX context cannot generate images"
        );
        Ok(Self {
            context: Mutex::new(context),
        })
    }

    pub fn inpaint(
        &self,
        image: &DynamicImage,
        mask: &DynamicImage,
        options: &Flux2InpaintOptions,
    ) -> Result<DynamicImage> {
        ensure!(
            image.dimensions() == mask.dimensions(),
            "image/mask dimensions mismatch"
        );
        if options.strength <= 0.0 || mask.to_luma8().pixels().all(|pixel| pixel.0[0] == 0) {
            return Ok(image.clone());
        }
        if let Some(bounds) = inpaint_crop_bounds(image, mask, options.mask_padding) {
            let image_crop = image.crop_imm(bounds.x, bounds.y, bounds.width, bounds.height);
            let mask_crop = mask.crop_imm(bounds.x, bounds.y, bounds.width, bounds.height);
            let generated = self.inpaint_full_frame(&image_crop, &mask_crop, options)?;
            return composite_inpaint_crop(image, &generated, &mask_crop, bounds);
        }
        self.inpaint_full_frame(image, mask, options)
    }

    fn inpaint_full_frame(
        &self,
        image: &DynamicImage,
        mask: &DynamicImage,
        options: &Flux2InpaintOptions,
    ) -> Result<DynamicImage> {
        let (rgb, size) = prepare_rgb_image(image, options.max_pixels);
        let mut native_mask = expand_mask(
            &prepare_mask(mask, size.width, size.height),
            options.mask_padding,
        );
        for pixel in native_mask.pixels_mut() {
            pixel.0[0] = if pixel.0[0] >= 128 { 255 } else { 0 };
        }
        let generated = self.generate(ImageGenerationParams {
            init_image: Some(rgb.clone()),
            reference_images: vec![rgb],
            mask_image: Some(native_mask),
            width: size.width as i32,
            height: size.height as i32,
            ..generation_params(options.num_inference_steps, options.strength)?
        })?;
        let mut output = resize_back_if_needed(generated, size);
        if image.color().has_alpha() {
            output = DynamicImage::ImageRgba8(inpainting::restore_alpha_channel(
                &output.to_rgb8(),
                &inpainting::extract_alpha(&image.to_rgba8()),
                &inpainting::binarize_mask(mask),
            ));
        }
        Ok(output)
    }

    pub fn image_to_image(
        &self,
        image: &DynamicImage,
        options: &Flux2ImageToImageOptions,
    ) -> Result<DynamicImage> {
        if options.strength <= 0.0 {
            return Ok(image.clone());
        }
        let (rgb, size) = prepare_rgb_image(image, options.max_pixels);
        let generated = self.generate(ImageGenerationParams {
            init_image: Some(rgb.clone()),
            reference_images: vec![rgb],
            width: size.width as i32,
            height: size.height as i32,
            ..generation_params(options.num_inference_steps, options.strength)?
        })?;
        let output = resize_back_if_needed(generated, size);
        if !image.color().has_alpha() {
            return Ok(output);
        }
        let mut rgba = output.to_rgba8();
        let original = image.to_rgba8();
        for (x, y, pixel) in rgba.enumerate_pixels_mut() {
            pixel.0[3] = original.get_pixel(x, y).0[3];
        }
        Ok(DynamicImage::ImageRgba8(rgba))
    }

    fn generate(&self, params: ImageGenerationParams) -> Result<image::RgbImage> {
        self.context
            .lock()
            .map_err(|_| anyhow::anyhow!("FLUX context lock was poisoned"))?
            .generate_image(&params)?
            .into_iter()
            .next()
            .context("FLUX returned no image")
    }
}

fn generation_params(steps: usize, strength: f64) -> Result<ImageGenerationParams> {
    ensure!(
        steps > 0 && steps <= i32::MAX as usize,
        "invalid FLUX step count"
    );
    ensure!(strength.is_finite(), "invalid FLUX strength");
    Ok(ImageGenerationParams {
        prompt: PROMPT.into(),
        reference_image_args: Some("resize_before_vae=0".into()),
        sample: SampleParams {
            guidance: GuidanceParams {
                text_cfg: 1.0,
                ..GuidanceParams::default()
            },
            scheduler: Scheduler::Flux2,
            sample_method: SampleMethod::Euler,
            sample_steps: steps as i32,
            ..SampleParams::default()
        },
        strength: native_strength(steps, strength),
        seed: -1,
        batch_count: 1,
        ..ImageGenerationParams::default()
    })
}

fn native_strength(steps: usize, strength: f64) -> f32 {
    // Preserve the previous runner's round(steps * strength), minimum one step.
    // SDCPP adds one step after truncating; stay just below its boundary.
    let effective = ((steps as f64 * strength.clamp(0.0, 1.0)).round() as usize).max(1);
    if effective >= steps {
        return 1.0;
    }
    let mut boundary = effective as f32 / steps as f32;
    while (steps as f32 * boundary) as usize >= effective {
        boundary = boundary.next_down();
    }
    boundary
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_strength_step_count_across_native_sampler_boundary() {
        for steps in 1..=100 {
            for fraction in 1..=100 {
                let strength = fraction as f64 / 100.0;
                let expected = ((steps as f64 * strength).round() as usize).max(1);
                let native = native_strength(steps, strength);
                let actual = ((steps as f32 * native) as usize + 1).min(steps);
                assert_eq!(actual, expected, "steps={steps}, strength={strength}");
            }
        }
    }
    #[test]
    fn rejects_nonfinite_strength_and_invalid_steps() {
        assert!(generation_params(0, 1.0).is_err());
        assert!(generation_params(4, f64::NAN).is_err());
        assert!(generation_params(4, f64::INFINITY).is_err());
        assert_eq!(generation_params(4, 1.0).unwrap().sample.sample_steps, 4);
    }
}
