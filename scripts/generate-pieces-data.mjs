import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const puzzles = [
  { file: "image_001.svg", slug: "cosmic-fox", name: "Cosmic Fox" },
  { file: "image_002.svg", slug: "futuristic-city", name: "Futuristic City" },
  { file: "image_003.svg", slug: "space-explorer", name: "Space Explorer" },
  { file: "image_004.svg", slug: "neon-cyberpunk", name: "Neon Cyberpunk" },
  { file: "image_005.svg", slug: "abstract-geometry", name: "Abstract Geometry" },
];

async function generate() {
  console.log("Generating puzzlePiecesData.ts...");
  const data = {};
  for (const p of puzzles) {
    const src = fs.readFileSync(path.join(process.cwd(), "public", "images", p.file));
    const master = await sharp(src, { density: 200 })
      .resize(800, 800, { fit: "cover" })
      .webp({ quality: 90 })
      .toBuffer();
    const pieces = [];
    for (let i = 0; i < 16; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const tile = await sharp(master)
        .extract({ left: col * 200, top: row * 200, width: 200, height: 200 })
        .webp({ quality: 92 })
        .toBuffer();
      pieces.push(`data:image/webp;base64,${tile.toString("base64")}`);
    }
    data[p.slug] = pieces;
  }

  const tsContent = `/**
 * Pre-sliced 200x200 WebP puzzle pieces (4x4) stored as base64 data URLs.
 * Serves pieces in 0ms without hitting external storage, database, or disk.
 * Total bundle overhead: ~68KB.
 */

export const PUZZLE_PIECES_DATA: Record<string, string[]> = ${JSON.stringify(data, null, 2)};

export function getPieceDataUrl(slug: string, pieceId: number): string | null {
  const pieces = PUZZLE_PIECES_DATA[slug];
  if (!pieces || pieceId < 0 || pieceId >= pieces.length) return null;
  return pieces[pieceId];
}

export function getPieceBuffer(slug: string, pieceId: number): Buffer | null {
  const dataUrl = getPieceDataUrl(slug, pieceId);
  if (!dataUrl) return null;
  const base64 = dataUrl.replace(/^data:image\\/webp;base64,/, "");
  return Buffer.from(base64, "base64");
}

export function getAllPiecesForSlug(slug: string): Record<number, string> | null {
  const pieces = PUZZLE_PIECES_DATA[slug];
  if (!pieces) return null;
  const result: Record<number, string> = {};
  for (let i = 0; i < pieces.length; i++) {
    result[i] = pieces[i];
  }
  return result;
}
`;

  fs.writeFileSync(path.join(process.cwd(), "src", "lib", "game", "puzzlePiecesData.ts"), tsContent);
  console.log(`Successfully wrote src/lib/game/puzzlePiecesData.ts (${Math.round(tsContent.length / 1024)} KB)`);
}

generate().catch((err) => {
  console.error("Failed to generate:", err);
  process.exit(1);
});
