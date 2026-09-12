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

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://dewdcxssvkvbgyyenmmu.supabase.co";

function getStorageOriginalUrl(slug: string): string {
  return `${supabaseUrl}/storage/v1/object/public/puzzle-images/${slug}/original.webp`;
}

const IMAGES: ImageMeta[] = [
  {
    id: "image_001",
    slug: "cosmic-fox",
    url: getStorageOriginalUrl("cosmic-fox"),
    name: "Cosmic Fox",
  },
  {
    id: "image_002",
    slug: "futuristic-city",
    url: getStorageOriginalUrl("futuristic-city"),
    name: "Futuristic City",
  },
  {
    id: "image_003",
    slug: "space-explorer",
    url: getStorageOriginalUrl("space-explorer"),
    name: "Space Explorer",
  },
  {
    id: "image_004",
    slug: "neon-cyberpunk",
    url: getStorageOriginalUrl("neon-cyberpunk"),
    name: "Neon Cyberpunk",
  },
  {
    id: "image_005",
    slug: "abstract-geometry",
    url: getStorageOriginalUrl("abstract-geometry"),
    name: "Abstract Geometry",
  },
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
