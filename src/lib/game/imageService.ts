/**
 * ImageService
 * ------------
 * Clean image-selection service (mirrors backend/app/services/image_service.py).
 *
 * `get_random_image()` returns metadata for a configurable set of puzzle
 * images. The registry intentionally contains ONLY metadata – never any
 * solution / ordering information. During the PUZZLE phase players are not
 * given the full image URL; they receive individually cropped pieces from the
 * authenticated /piece endpoint instead.
 */
import type { ImageMeta } from "./types";

const IMAGES: ImageMeta[] = [
  { id: "image_001", url: "/images/image_001.svg", name: "Mountain Vista" },
  { id: "image_002", url: "/images/image_002.svg", name: "Deep Ocean" },
  { id: "image_003", url: "/images/image_003.svg", name: "Cosmic Journey" },
  { id: "image_004", url: "/images/image_004.svg", name: "Enchanted Forest" },
  { id: "image_005", url: "/images/image_005.svg", name: "Neon City" },
];

export class ImageService {
  constructor(private readonly images: ImageMeta[] = IMAGES) {}

  list(): ImageMeta[] {
    return [...this.images];
  }

  get(id: string): ImageMeta | undefined {
    return this.images.find((i) => i.id === id);
  }

  /** Pick a random image, optionally avoiding recently used ids. */
  getRandomImage(excludeIds: string[] = []): ImageMeta {
    const pool =
      this.images.filter((i) => !excludeIds.includes(i.id)) ?? [];
    const choices = pool.length > 0 ? pool : this.images;
    return choices[Math.floor(Math.random() * choices.length)];
  }
}

/** Logical canvas size shared by every source SVG (viewBox 0 0 800 800). */
export const SOURCE_VIEWBOX = 800;

export const imageService = new ImageService();
