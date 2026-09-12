import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const BUCKET_NAME = "puzzle-images";
const TARGET_SIZE = 800;
const GRID_ROWS = 4;
const GRID_COLS = 4;
const TILE_WIDTH = TARGET_SIZE / GRID_COLS; // 200
const TILE_HEIGHT = TARGET_SIZE / GRID_ROWS; // 200

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

async function seedPuzzles() {
  console.log("🧩 Starting Fuzal Puzzle Seed Process...");

  // Ensure storage bucket exists
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    console.error("Failed to list buckets:", bucketError.message);
  } else if (!buckets.find((b) => b.id === BUCKET_NAME)) {
    console.log(`Creating bucket '${BUCKET_NAME}'...`);
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      allowedMimeTypes: ["image/webp", "image/png", "image/jpeg"],
    });
    if (createError) console.error("Error creating bucket:", createError.message);
  }

  for (const puzzle of PUZZLES) {
    console.log(`\n🎨 Processing puzzle: ${puzzle.name} (${puzzle.slug})...`);
    const srcPath = path.join(process.cwd(), "public", "images", puzzle.file);

    let srcBuffer: Buffer;
    try {
      srcBuffer = await fs.readFile(srcPath);
    } catch (e) {
      console.warn(`Source file not found at ${srcPath}, skipping.`);
      continue;
    }

    // 1. Render master 800x800 square image as WebP
    const masterWebPBuffer = await sharp(srcBuffer, { density: 200 })
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover" })
      .webp({ quality: 90 })
      .toBuffer();

    // 2. Upload master original image
    const originalPath = `${puzzle.slug}/original.webp`;
    const { error: origUploadErr } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(originalPath, masterWebPBuffer, {
        contentType: "image/webp",
        upsert: true,
      });

    if (origUploadErr) {
      console.error(`Failed to upload ${originalPath}:`, origUploadErr.message);
      continue;
    }
    console.log(`  ✓ Uploaded original: ${originalPath}`);

    // 3. Slice into 16 tiles (4x4)
    const masterSharp = sharp(masterWebPBuffer);
    for (let pieceId = 0; pieceId < GRID_ROWS * GRID_COLS; pieceId++) {
      const col = pieceId % GRID_COLS;
      const row = Math.floor(pieceId / GRID_COLS);
      const left = col * TILE_WIDTH;
      const top = row * TILE_HEIGHT;

      const tileBuffer = await masterSharp
        .clone()
        .extract({ left, top, width: TILE_WIDTH, height: TILE_HEIGHT })
        .webp({ quality: 92 })
        .toBuffer();

      const pieceNumStr = String(pieceId).padStart(2, "0");
      const piecePath = `${puzzle.slug}/pieces/${pieceNumStr}.webp`;

      const { error: tileUploadErr } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(piecePath, tileBuffer, {
          contentType: "image/webp",
          upsert: true,
        });

      if (tileUploadErr) {
        console.error(`  ✗ Failed to upload tile ${piecePath}:`, tileUploadErr.message);
      }
    }
    console.log(`  ✓ Uploaded all 16 pre-generated WebP tiles for ${puzzle.slug}`);

    // 4. Upsert row into puzzle_images table
    const { data: existingRows } = await supabase
      .from("puzzle_images")
      .select("id")
      .eq("name", puzzle.name)
      .limit(1);

    if (existingRows && existingRows.length > 0) {
      await supabase
        .from("puzzle_images")
        .update({
          storage_path: puzzle.slug,
          mime_type: "image/webp",
          width: TARGET_SIZE,
          height: TARGET_SIZE,
          grid_rows: GRID_ROWS,
          grid_columns: GRID_COLS,
          active: true,
        })
        .eq("id", existingRows[0].id);
      console.log(`  ✓ Updated puzzle_images row (${existingRows[0].id})`);
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("puzzle_images")
        .insert({
          name: puzzle.name,
          storage_path: puzzle.slug,
          mime_type: "image/webp",
          width: TARGET_SIZE,
          height: TARGET_SIZE,
          grid_rows: GRID_ROWS,
          grid_columns: GRID_COLS,
          active: true,
        })
        .select("id")
        .single();

      if (insertErr) {
        console.error(`Failed to insert puzzle_images row:`, insertErr.message);
      } else {
        console.log(`  ✓ Inserted new puzzle_images row (${inserted?.id})`);
      }
    }
  }

  console.log("\n🎉 All puzzle images and pieces successfully seeded!");
}

seedPuzzles().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
