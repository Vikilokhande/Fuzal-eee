import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface PieceRect {
  col: number;
  row: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  width: number;
  height: number;
}

/**
 * Exact mathematical piece slicing formula:
 * For column c:
 *   x0 = floor(c * sourceWidth / N)
 *   x1 = floor((c + 1) * sourceWidth / N)
 * For row r:
 *   y0 = floor(r * sourceHeight / N)
 *   y1 = floor((r + 1) * sourceHeight / N)
 * Piece:
 *   x = x0, y = y0, width = x1 - x0, height = y1 - y0
 */
export function calculatePieceRect(
  sourceWidth: number,
  sourceHeight: number,
  gridSize: number,
  pieceId: number,
): PieceRect {
  if (gridSize < 2 || gridSize > 8) {
    throw new Error(`Unsupported gridSize ${gridSize}. Must be 2 <= N <= 8.`);
  }
  const total = gridSize * gridSize;
  if (pieceId < 0 || pieceId >= total) {
    throw new Error(`Invalid pieceId ${pieceId} for grid ${gridSize}x${gridSize}.`);
  }

  const col = pieceId % gridSize;
  const row = Math.floor(pieceId / gridSize);

  const x0 = Math.floor((col * sourceWidth) / gridSize);
  const x1 = Math.floor(((col + 1) * sourceWidth) / gridSize);
  const y0 = Math.floor((row * sourceHeight) / gridSize);
  const y1 = Math.floor(((row + 1) * sourceHeight) / gridSize);

  return {
    col,
    row,
    x0,
    x1,
    y0,
    y1,
    width: x1 - x0,
    height: y1 - y0,
  };
}

/**
 * Local fallback mapping for offline development and testing
 */
const SLUG_TO_FILE: Record<string, string> = {
  "cosmic-fox": "image_001.svg",
  "futuristic-city": "image_002.svg",
  "space-explorer": "image_003.svg",
  "neon-cyberpunk": "image_004.svg",
  "abstract-geometry": "image_005.svg",
};

/** In-memory cache of master raw image buffers */
const masterImageCache = new Map<string, Buffer>();

/** In-memory cache of sliced piece WebP buffers: `${slug}:${N}x${N}:${pieceId}` */
const pieceCache = new Map<string, Buffer>();

/**
 * Retrieve the canonical square master image buffer for a given puzzle slug.
 * Prioritizes Supabase Storage public CDN / SDK download, with local SVG fallback.
 */
export async function getMasterImageBuffer(slug: string): Promise<Buffer> {
  const cached = masterImageCache.get(slug);
  if (cached) return cached;

  // 1. Try downloading original.webp from Supabase Storage
  try {
    const { data, error } = await supabaseAdmin.storage
      .from("puzzle-images")
      .download(`${slug}/original.webp`);

    if (data && !error) {
      const buf = Buffer.from(await data.arrayBuffer());
      masterImageCache.set(slug, buf);
      return buf;
    }
  } catch (err) {
    console.warn(`[SLICER] Supabase download error for ${slug}:`, err);
  }

  // 2. Local fallback from public/images
  const svgFile = SLUG_TO_FILE[slug];
  if (svgFile) {
    try {
      const localPath = path.join(process.cwd(), "public", "images", svgFile);
      const svgBuf = await fs.readFile(localPath);
      // Render to 900x900 canonical square WebP
      const rendered = await sharp(svgBuf, { density: 200 })
        .resize(900, 900, { fit: "cover" })
        .webp({ quality: 90 })
        .toBuffer();
      masterImageCache.set(slug, rendered);
      return rendered;
    } catch (localErr) {
      console.warn(`[SLICER] Local SVG read error for ${slug}:`, localErr);
    }
  }

  throw new Error(`Master image not found for slug: "${slug}"`);
}

/**
 * Slices a single piece directly from the canonical master image.
 * Guarantees zero gaps, zero overlaps, and exact mathematical boundaries.
 */
export async function slicePiece(
  slug: string,
  gridSize: number,
  pieceId: number,
): Promise<Buffer> {
  const cacheKey = `${slug}:${gridSize}x${gridSize}:${pieceId}`;
  const cached = pieceCache.get(cacheKey);
  if (cached) return cached;

  const masterBuf = await getMasterImageBuffer(slug);
  const metadata = await sharp(masterBuf).metadata();
  const width = metadata.width || 900;
  const height = metadata.height || 900;

  const rect = calculatePieceRect(width, height, gridSize, pieceId);

  const slicedBuf = await sharp(masterBuf)
    .extract({
      left: rect.x0,
      top: rect.y0,
      width: rect.width,
      height: rect.height,
    })
    .webp({ quality: 90 })
    .toBuffer();

  pieceCache.set(cacheKey, slicedBuf);
  return slicedBuf;
}

/**
 * Slices all N*N pieces directly from the canonical master image.
 * Returns a map of pieceId -> base64 data URL.
 */
export async function sliceAllPieces(
  slug: string,
  gridSize: number,
): Promise<Record<number, string>> {
  const total = gridSize * gridSize;
  const masterBuf = await getMasterImageBuffer(slug);
  const metadata = await sharp(masterBuf).metadata();
  const width = metadata.width || 900;
  const height = metadata.height || 900;

  const results: Record<number, string> = {};
  const tasks: Promise<void>[] = [];

  for (let pieceId = 0; pieceId < total; pieceId++) {
    const cacheKey = `${slug}:${gridSize}x${gridSize}:${pieceId}`;
    const cached = pieceCache.get(cacheKey);
    if (cached) {
      results[pieceId] = `data:image/webp;base64,${cached.toString("base64")}`;
      continue;
    }

    const rect = calculatePieceRect(width, height, gridSize, pieceId);
    tasks.push(
      sharp(masterBuf)
        .extract({
          left: rect.x0,
          top: rect.y0,
          width: rect.width,
          height: rect.height,
        })
        .webp({ quality: 90 })
        .toBuffer()
        .then((buf) => {
          pieceCache.set(cacheKey, buf);
          results[pieceId] = `data:image/webp;base64,${buf.toString("base64")}`;
        }),
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }

  return results;
}

/**
 * Clears in-memory slicing caches (useful for testing or cache invalidation)
 */
export function clearSlicerCache(): void {
  masterImageCache.clear();
  pieceCache.clear();
}
