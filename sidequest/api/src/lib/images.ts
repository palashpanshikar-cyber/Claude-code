import sharp from 'sharp';

export interface ProcessedImage {
  buffer: Buffer;
  mimetype: string;
  width?: number;
  height?: number;
  /** True when processing was skipped and the original bytes are being stored. */
  passthrough: boolean;
}

export const IMAGE_PRESETS = {
  /** Completion photos: big enough for a full-bleed phone screen at 3x. */
  completion: { maxDim: 1600, quality: 82 },
  /** Avatars: never displayed larger than a profile header. */
  avatar: { maxDim: 512, quality: 85 },
} as const;

/**
 * Downscales and re-encodes an upload to JPEG.
 *
 * Phones produce 4-12MB HEIC/JPEG originals; storing those costs bandwidth on
 * every profile grid render. JPEG rather than WebP because it decodes natively
 * everywhere including older Android WebViews, and the size difference at this
 * quality is small.
 *
 * EXIF is dropped except for orientation, which is baked into the pixels first
 * — an upload should not carry the GPS coordinates of where it was taken into
 * a public feed.
 */
export async function processImage(
  buffer: Buffer,
  originalMimetype: string,
  preset: keyof typeof IMAGE_PRESETS,
): Promise<ProcessedImage> {
  const { maxDim, quality } = IMAGE_PRESETS[preset];

  try {
    const pipeline = sharp(buffer, { failOn: 'none' })
      .rotate() // applies EXIF orientation, then discards the tag
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      mimetype: 'image/jpeg',
      width: info.width,
      height: info.height,
      passthrough: false,
    };
  } catch {
    // A format sharp cannot decode is not a reason to lose the user's photo —
    // they already did the quest. Store the original and move on.
    return { buffer, mimetype: originalMimetype, passthrough: true };
  }
}
