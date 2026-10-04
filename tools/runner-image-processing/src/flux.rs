use anyhow::{Result, bail};
use image::{DynamicImage, GenericImageView, GrayImage, RgbImage};
use imageproc::{distance_transform::Norm, morphology::dilate};
pub const VAE_SCALE_FACTOR: u32 = 8;
pub const LATENT_PACK_FACTOR: u32 = 2;
pub const IMAGE_MULTIPLE: u32 = VAE_SCALE_FACTOR * LATENT_PACK_FACTOR;

#[derive(Debug, Clone, Copy)]
pub struct PreparedSize {
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
}

pub fn bounded_size(width: u32, height: u32, max_pixels: u32) -> (u32, u32) {
    if max_pixels == 0 || width.saturating_mul(height) <= max_pixels {
        return (width, height);
    }
    let scale = (max_pixels as f64 / (width as f64 * height as f64)).sqrt();
    (
        ((width as f64 * scale).floor() as u32).max(IMAGE_MULTIPLE),
        ((height as f64 * scale).floor() as u32).max(IMAGE_MULTIPLE),
    )
}

pub fn round_to_flux_multiple(width: u32, height: u32) -> (u32, u32) {
    let round = |v: u32| (v / IMAGE_MULTIPLE).max(1) * IMAGE_MULTIPLE;
    (round(width), round(height))
}

pub fn prepare_rgb_image(image: &DynamicImage, max_pixels: u32) -> (RgbImage, PreparedSize) {
    let original_width = image.width();
    let original_height = image.height();
    let (width, height) = bounded_size(original_width, original_height, max_pixels);
    let (width, height) = round_to_flux_multiple(width, height);
    let rgb = image.to_rgb8();
    let resized = if width == original_width && height == original_height {
        rgb
    } else {
        image::imageops::resize(&rgb, width, height, image::imageops::FilterType::Lanczos3)
    };
    (
        resized,
        PreparedSize {
            width,
            height,
            original_width,
            original_height,
        },
    )
}

pub fn prepare_mask(mask: &DynamicImage, width: u32, height: u32) -> GrayImage {
    let gray = mask.to_luma8();
    image::imageops::resize(&gray, width, height, image::imageops::FilterType::Triangle)
}

pub fn expand_mask(mask: &GrayImage, padding: u8) -> GrayImage {
    if padding == 0 {
        mask.clone()
    } else {
        dilate(mask, Norm::LInf, padding)
    }
}

pub fn resize_back_if_needed(image: RgbImage, size: PreparedSize) -> DynamicImage {
    let out = if image.width() == size.original_width && image.height() == size.original_height {
        image
    } else {
        image::imageops::resize(
            &image,
            size.original_width,
            size.original_height,
            image::imageops::FilterType::Lanczos3,
        )
    };
    DynamicImage::ImageRgb8(out)
}

const INPAINT_CROP_CONTEXT: u32 = 64;
#[derive(Debug, Clone, Copy)]
pub struct CropBounds {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

pub fn inpaint_crop_bounds(
    image: &DynamicImage,
    mask: &DynamicImage,
    mask_padding: u8,
) -> Option<CropBounds> {
    let gray = mask.to_luma8();
    let mut min_x = gray.width();
    let mut min_y = gray.height();
    let mut max_x = 0;
    let mut max_y = 0;
    let mut found = false;
    for (x, y, pixel) in gray.enumerate_pixels() {
        if pixel.0[0] == 0 {
            continue;
        }
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
        found = true;
    }
    if !found {
        return None;
    }

    let padding = INPAINT_CROP_CONTEXT.max(mask_padding as u32);
    let multiple = IMAGE_MULTIPLE;
    let width = image.width();
    let height = image.height();
    let mut x0 = min_x.saturating_sub(padding);
    let mut y0 = min_y.saturating_sub(padding);
    let mut x1 = (max_x + 1 + padding).min(width);
    let mut y1 = (max_y + 1 + padding).min(height);

    x0 = (x0 / multiple) * multiple;
    y0 = (y0 / multiple) * multiple;
    x1 = x1.div_ceil(multiple) * multiple;
    y1 = y1.div_ceil(multiple) * multiple;
    x1 = x1.min(width);
    y1 = y1.min(height);

    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    if x0 == 0 && y0 == 0 && x1 == width && y1 == height {
        return None;
    }

    Some(CropBounds {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
    })
}

pub fn composite_inpaint_crop(
    original: &DynamicImage,
    generated_crop: &DynamicImage,
    mask_crop: &DynamicImage,
    bounds: CropBounds,
) -> Result<DynamicImage> {
    if generated_crop.dimensions() != (bounds.width, bounds.height) {
        bail!(
            "generated crop dimensions mismatch: got {:?}, expected {}x{}",
            generated_crop.dimensions(),
            bounds.width,
            bounds.height
        );
    }

    let mut output = original.to_rgba8();
    let generated = generated_crop.to_rgba8();
    let mask = mask_crop.to_luma8();
    for y in 0..bounds.height {
        for x in 0..bounds.width {
            let alpha = mask.get_pixel(x, y).0[0] as f32 / 255.0;
            if alpha <= 0.0 {
                continue;
            }
            let generated_pixel = generated.get_pixel(x, y).0;
            let output_pixel = output.get_pixel_mut(bounds.x + x, bounds.y + y);
            for (channel, generated_channel) in generated_pixel.iter().enumerate().take(3) {
                output_pixel.0[channel] = (output_pixel.0[channel] as f32 * (1.0 - alpha)
                    + *generated_channel as f32 * alpha)
                    .round()
                    .clamp(0.0, 255.0) as u8;
            }
        }
    }

    if original.color().has_alpha() {
        Ok(DynamicImage::ImageRgba8(output))
    } else {
        Ok(DynamicImage::ImageRgb8(
            DynamicImage::ImageRgba8(output).to_rgb8(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Luma, Rgb, Rgba, RgbaImage};
    #[test]
    fn sizing_preserves_budget_multiple_and_original_dimensions() {
        let image =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(511, 769, Rgba([20, 40, 60, 91])));
        let (prepared, size) = prepare_rgb_image(&image, 128 * 128);
        assert_eq!(prepared.dimensions(), (96, 144));
        assert_eq!(
            resize_back_if_needed(prepared, size).dimensions(),
            image.dimensions()
        );
        assert_eq!(round_to_flux_multiple(1, 17), (16, 16));
    }
    #[test]
    fn crop_bounds_and_masked_composite_preserve_unmasked_rgb_and_alpha() {
        let original =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(256, 256, Rgba([20, 40, 60, 91])));
        let mut mask = GrayImage::new(256, 256);
        mask.put_pixel(120, 120, Luma([255]));
        mask.put_pixel(121, 120, Luma([128]));
        let mask = DynamicImage::ImageLuma8(mask);
        let bounds = inpaint_crop_bounds(&original, &mask, 0).unwrap();
        assert_eq!(
            (bounds.x, bounds.y, bounds.width, bounds.height),
            (48, 48, 144, 144)
        );
        let generated = DynamicImage::ImageRgb8(RgbImage::from_pixel(
            bounds.width,
            bounds.height,
            Rgb([100, 120, 140]),
        ));
        let result = composite_inpaint_crop(
            &original,
            &generated,
            &mask.crop_imm(bounds.x, bounds.y, bounds.width, bounds.height),
            bounds,
        )
        .unwrap()
        .to_rgba8();
        assert_eq!(result.get_pixel(0, 0).0, [20, 40, 60, 91]);
        assert_eq!(result.get_pixel(120, 120).0, [100, 120, 140, 91]);
        assert_eq!(result.get_pixel(121, 120).0, [60, 80, 100, 91]);
        assert!(
            inpaint_crop_bounds(
                &original,
                &DynamicImage::ImageLuma8(GrayImage::new(256, 256)),
                0
            )
            .is_none()
        );
    }
    #[test]
    fn mask_expansion_and_invalid_crop_dimensions() {
        let mut mask = GrayImage::new(7, 7);
        mask.put_pixel(3, 3, Luma([255]));
        assert_eq!(expand_mask(&mask, 0), mask);
        assert_eq!(
            expand_mask(&mask, 1)
                .pixels()
                .filter(|p| p.0[0] > 0)
                .count(),
            9
        );
        let original = DynamicImage::new_rgb8(16, 16);
        assert!(
            composite_inpaint_crop(
                &original,
                &original,
                &DynamicImage::ImageLuma8(mask),
                CropBounds {
                    x: 0,
                    y: 0,
                    width: 8,
                    height: 8
                }
            )
            .is_err()
        );
    }
}
