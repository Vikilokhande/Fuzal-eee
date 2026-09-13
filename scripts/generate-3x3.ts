import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const TARGET_SIZE = 900;
const GRID_ROWS = 3;
const GRID_COLS = 3;
const TILE_WIDTH = TARGET_SIZE / GRID_COLS; // 300
const TILE_HEIGHT = TARGET_SIZE / GRID_ROWS; // 300

interface PuzzleDef {
  file: string;
  slug: string;
  name: string;
}

const PUZZLES: PuzzleDef[] = [
  { file: "image_001.svg", slug: "cosmic-fox", name: "Cosmic Fox" },
  { file: "image_002.svg", slug: "futuristic-city", name: "Futuristic City" },
  { file: "image_003.svg", slug: "space-explorer", name: "Space Explorer" },
  { file: "image_004.svg", slug: "neon-cyberpunk", name: "Neon Cyberpunk" },
  { file: "image_005.svg", slug: "abstract-geometry", name: "Abstract Geometry" },
];

async function run() {
  const result: Record<string, string[]> = {};

  for (const p of PUZZLES) {
    const srcPath = path.join(process.cwd(), "public", "images", p.file);
    const svgBuf = await fs.readFile(srcPath);

    const masterWebP = await sharp(svgBuf, { density: 200 })
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover" })
      .webp({ quality: 90 })
      .toBuffer();

    const masterSharp = sharp(masterWebP);
    const pieces: string[] = [];

    for (let i = 0; i < GRID_ROWS * GRID_COLS; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const left = col * TILE_WIDTH;
      const top = row * TILE_HEIGHT;

      const tileBuf = await masterSharp
        .clone()
        .extract({ left, top, width: TILE_WIDTH, height: TILE_HEIGHT })
        .webp({ quality: 85 })
        .toBuffer();

      const b64 = tileBuf.toString("base64");
      pieces.push(`data:image/webp;base64,${b64}`);
    }

    result[p.slug] = pieces;
    console.log(`Generated 9 tiles for ${p.slug}`);
  }

  // Generate puzzlePiecesData.ts content
  let tsCode = `/**\n * Pre-sliced 300x300 WebP puzzle pieces (3x3, total 9) stored as base64 data URLs.\n * Serves pieces in 0ms without hitting external storage, database, or disk.\n * Total bundle overhead: ~40KB.\n */\n\nexport const PUZZLE_PIECES_DATA: Record<string, string[]> = {\n`;

  for (const [slug, tiles] of Object.entries(result)) {
    tsCode += `  "${slug}": [\n`;
    for (const t of tiles) {
      tsCode += `    "${t}",\n`;
    }
    tsCode += `  ],\n`;
  }
  tsCode += `};\n\n`;

  tsCode += `export function getPieceDataUrl(slug: string, pieceId: number): string | null {\n`;
  tsCode += `  const pieces = PUZZLE_PIECES_DATA[slug];\n`;
  tsCode += `  if (!pieces || pieceId < 0 || pieceId >= pieces.length) return null;\n`;
  tsCode += `  return pieces[pieceId];\n`;
  tsCode += `}\n\n`;

  tsCode += `export function getPieceBuffer(slug: string, pieceId: number): Buffer | null {\n`;
  tsCode += `  const dataUrl = getPieceDataUrl(slug, pieceId);\n`;
  tsCode += `  if (!dataUrl) return null;\n`;
  tsCode += `  const base64 = dataUrl.replace(/^data:image\\/webp;base64,/, "");\n`;
  tsCode += `  return Buffer.from(base64, "base64");\n`;
  tsCode += `}\n\n`;

  tsCode += `export function getAllPiecesForSlug(slug: string): Record<number, string> | null {\n`;
  tsCode += `  const pieces = PUZZLE_PIECES_DATA[slug];\n`;
  tsCode += `  if (!pieces) return null;\n`;
  tsCode += `  const result: Record<number, string> = {};\n`;
  tsCode += `  for (let i = 0; i < pieces.length; i++) {\n`;
  tsCode += `    result[i] = pieces[i];\n`;
  tsCode += `  }\n`;
  tsCode += `  return result;\n`;
  tsCode += `}\n`;

  await fs.writeFile(
    path.join(process.cwd(), "src", "lib", "game", "puzzlePiecesData.ts"),
    tsCode,
    "utf-8"
  );
  console.log("Successfully wrote src/lib/game/puzzlePiecesData.ts with 3x3 tiles!");
}

run().catch(console.error);
