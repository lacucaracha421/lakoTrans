mod model;

use std::{
    path::Path,
    time::Instant,
};

use anyhow::{Context, Result, bail};
use koharu_torch::Device;
use image::{DynamicImage, GenericImageView, GrayImage, RgbImage};

use serde::Deserialize;
use tracing::instrument;

use crate::{
    inpainting::{
        HdStrategyConfig, InpaintForward, apply_bubble_fill, binarize_mask, extract_alpha,
        restore_alpha_channel, run_inpaint,
    },
};

use self::model::Model;





#[derive(Debug)]
pub struct AotInpainting {
    model: Model,
    config: AotInpaintingConfig,
    device: Device,
}

#[derive(Debug, Clone, Deserialize)]
struct AotInpaintingConfig {
    model_type: String,
    input_channels: usize,
    output_channels: usize,
    base_channels: usize,
    num_blocks: usize,
    dilation_rates: Vec<usize>,
    pad_multiple: usize,
    default_max_side: u32,
}

impl AotInpaintingConfig {
    fn validate(&self) -> Result<()> {
        if self.model_type != "manga-image-translator-aot" {
            bail!("unsupported AOT inpainting model type {}", self.model_type);
        }
        if self.input_channels != 4 {
            bail!("expected input_channels=4, found {}", self.input_channels);
        }
        if self.output_channels != 3 {
            bail!("expected output_channels=3, found {}", self.output_channels);
        }
        if self.base_channels == 0 {
            bail!("base_channels must be positive");
        }
        if self.num_blocks == 0 {
            bail!("num_blocks must be positive");
        }
        if self.dilation_rates.is_empty() {
            bail!("dilation_rates must not be empty");
        }
        if self.pad_multiple == 0 {
            bail!("pad_multiple must be positive");
        }
        if self.default_max_side == 0 {
            bail!("default_max_side must be positive");
        }
        Ok(())
    }

}

impl AotInpainting {
    pub fn load_from_paths(config_path: impl AsRef<Path>, weights_path: impl AsRef<Path>, device: Device) -> Result<Self> {
        let config: AotInpaintingConfig = serde_json::from_slice(&std::fs::read(config_path.as_ref())?)
            .with_context(|| format!("failed to parse {}", config_path.as_ref().display()))?;
        config.validate()?;
        anyhow::ensure!(config.base_channels == 32 && config.num_blocks == 10 && config.dilation_rates == [2, 4, 8, 16],
            "AOT model configuration differs from the pinned Koharu 0.83.5 architecture");
        let mut model = Model::new(device);
        model.load(weights_path)?;
        Ok(Self { model, config, device })
    }

    /// Default strategy: Resize, using the model's shipped `default_max_side`
    /// as the resize limit. Matches pre-refactor behaviour.
    pub fn default_config(&self) -> HdStrategyConfig {
        HdStrategyConfig::aot_default(
            self.config.default_max_side,
            self.config.pad_multiple as u32,
        )
    }

    #[instrument(level = "debug", skip_all)]
    pub fn inference(
        &self,
        image: &DynamicImage,
        mask: &DynamicImage,
        bubble_mask: &DynamicImage,
    ) -> Result<DynamicImage> {
        self.inference_with_config(image, mask, bubble_mask, &self.default_config())
    }

    #[instrument(level = "debug", skip_all)]
    pub fn inference_with_config(
        &self,
        image: &DynamicImage,
        mask: &DynamicImage,
        bubble_mask: &DynamicImage,
        cfg: &HdStrategyConfig,
    ) -> Result<DynamicImage> {
        if image.dimensions() != mask.dimensions() || image.dimensions() != bubble_mask.dimensions()
        {
            bail!(
                "image/mask/bubble dimensions dismatch: image is {:?}, mask is {:?}, bubble is {:?}",
                image.dimensions(),
                mask.dimensions(),
                bubble_mask.dimensions()
            );
        }

        let started = Instant::now();
        let binary_mask = binarize_mask(mask);
        let bubble_mask = bubble_mask.to_luma8();
        let image_rgb = image.to_rgb8();
        let forward = AotForward { aot: self };
        let output_rgb = run_inpaint(&forward, &image_rgb, &binary_mask, Some(&bubble_mask), cfg)?;

        tracing::info!(
            width = image.width(),
            height = image.height(),
            resize_limit = cfg.resize_limit,
            total_ms = started.elapsed().as_millis(),
            "aot inpainting timings"
        );

        if image.color().has_alpha() {
            let alpha = extract_alpha(&image.to_rgba8());
            let rgba = restore_alpha_channel(&output_rgb, &alpha, &binary_mask);
            Ok(DynamicImage::ImageRgba8(rgba))
        } else {
            Ok(DynamicImage::ImageRgb8(output_rgb))
        }
    }

    /// Raw model forward on a pre-padded RGB image + mask. Input spatial dims
    /// must already be multiples of `pad_multiple` — the HD-strategy dispatcher
    /// handles this.
    fn forward_rgb(&self, image: &RgbImage, mask: &GrayImage) -> Result<RgbImage> {
        koharu_torch::no_grad(|| {
            let image = crate::rgb_tensor(image, self.device) / 127.5 - 1.0;
            let mask = crate::mask_tensor(mask, self.device) / 255.0;
            let masked = image * (mask.ones_like() - &mask);
            crate::tensor_rgb(&((self.model.forward(&masked, &mask) + 1.0) * 127.5))
        })
    }

}

struct AotForward<'a> {
    aot: &'a AotInpainting,
}

impl InpaintForward for AotForward<'_> {
    fn forward(
        &self,
        image: &RgbImage,
        mask: &GrayImage,
        bubble_mask: Option<&GrayImage>,
    ) -> Result<RgbImage> {
        if mask.pixels().all(|p| p.0[0] == 0) {
            return Ok(image.clone());
        }

        let (image, mask) = if let Some(bubble_mask) = bubble_mask {
            let filled = apply_bubble_fill(image, mask, bubble_mask);
            tracing::debug!(
                filled_pixels = filled.filled_pixels,
                "aot bubble fill fast path"
            );
            (filled.image, filled.remaining_mask)
        } else {
            (image.clone(), mask.clone())
        };

        if mask.pixels().all(|p| p.0[0] == 0) {
            return Ok(image);
        }
        self.aot.forward_rgb(&image, &mask)
    }
}

