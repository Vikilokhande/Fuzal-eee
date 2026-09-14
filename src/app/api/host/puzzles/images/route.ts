import { NextRequest, NextResponse } from "next/server";
import type { Metadata } from "sharp";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { imageService } from "@/lib/game/imageService";
import { calculatePieceRect } from "@/lib/game/slicer";
import type { PuzzleImageDef } from "@/lib/game/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function getSharp() {
  try {
    const mod = await import("sharp");
    return (mod.default || mod) as unknown as typeof import("sharp");
  } catch (err: any) {
    console.error("[HOST_PUZZLE_UPLOAD_ERROR] Failed to load sharp library:", err?.message || err);
    throw new Error(`Sharp image processor failed to initialize in runtime: ${err?.message || "native binding missing"}`);
  }
}

const BUCKET_NAME = "puzzle-images";
const TARGET_SIZE = 900;
const SUPPORTED_GRID_SIZES = [2, 3, 4, 5, 6, 7, 8] as const;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const BATCH_SIZE = 8; // Bounded concurrency for serverless memory safety

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://dewdcxssvkvbgyyenmmu.supabase.co";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function runBatched<T>(tasks: (() => Promise<T>)[], batchSize = BATCH_SIZE): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const chunk = tasks.slice(i, i + batchSize);
    const chunkResults = await Promise.all(chunk.map((fn) => fn()));
    results.push(...chunkResults);
  }
  return results;
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const startTime = performance.now();
  let stage = "START";

  console.log(`[HOST_PUZZLE_UPLOAD_START] requestId=${requestId} method=POST endpoint=/api/host/puzzles/images`);

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "DB_NOT_CONFIGURED", message: "Supabase storage is not configured" },
        { status: 503 },
      );
    }

    // 1. Parse and Validate Form Data
    stage = "VALIDATE";
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const rawName = formData.get("name") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Image file is required" },
        { status: 400 },
      );
    }

    const name = rawName?.trim() || file.name.replace(/\.[^/.]+$/, "") || "Custom Puzzle";
    if (name.length < 2 || name.length > 50) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Puzzle name must be between 2 and 50 characters" },
        { status: 400 },
      );
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `File size (${Math.round(file.size / 1024)}KB) exceeds 5MB limit` },
        { status: 400 },
      );
    }

    // Validate MIME type
    const validMimes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!validMimes.includes(file.type)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Unsupported file type. Please upload a PNG, JPEG, or WebP image." },
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Obtain Sharp image processor safely
    const sharp = await getSharp();

    // Validate image dimensions via Sharp metadata
    let originalMetadata: Metadata;
    try {
      originalMetadata = await sharp(fileBuffer).metadata();
    } catch (metaErr: any) {
      console.error(`[HOST_PUZZLE_UPLOAD_ERROR] requestId=${requestId} stage=VALIDATE error=Invalid image data: ${metaErr?.message}`);
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "File could not be parsed as a valid image" },
        { status: 400 },
      );
    }

    const origWidth = originalMetadata.width || 0;
    const origHeight = originalMetadata.height || 0;

    if (origWidth < 100 || origHeight < 100) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Image resolution is too small. Minimum dimensions are 100x100." },
        { status: 400 },
      );
    }

    console.log(
      `[HOST_PUZZLE_UPLOAD_VALIDATED] requestId=${requestId} name="${name}" fileSize=${file.size} mimeType=${file.type} dimensions=${origWidth}x${origHeight}`,
    );

    // 2. Render Canonical Master 900x900 Square WebP
    stage = "PROCESSING";
    let masterWebP: Buffer;
    try {
      masterWebP = await sharp(fileBuffer, { density: 200 })
        .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "center" })
        .webp({ quality: 90 })
        .toBuffer();
    } catch (err: any) {
      console.error(`[HOST_PUZZLE_UPLOAD_ERROR] requestId=${requestId} stage=PROCESSING error=${err?.message}`);
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Failed to render master image. Ensure file is a valid image." },
        { status: 400 },
      );
    }

    const baseSlug = slugify(name);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    // 3. Upload Master Original to Supabase Storage
    stage = "STORAGE";
    const originalPath = `${slug}/original.webp`;
    const { error: origErr } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(originalPath, masterWebP, {
        contentType: "image/webp",
        upsert: true,
      });

    if (origErr) {
      console.error(`[HOST_PUZZLE_UPLOAD_ERROR] requestId=${requestId} stage=STORAGE path=${originalPath} error=${origErr.message}`);
      return NextResponse.json(
        { error: "STORAGE_ERROR", message: `Failed to upload image to storage: ${origErr.message}` },
        { status: 500 },
      );
    }

    console.log(`[HOST_PUZZLE_UPLOAD_STORAGE] requestId=${requestId} originalPath=${originalPath}`);

    // 4. Pre-generate tiles for grids 2x2 through 8x8 using Sharp with Bounded Concurrency
    stage = "GENERATING PIECES";
    const masterSharp = sharp(masterWebP);
    const tileTasks: (() => Promise<void>)[] = [];

    for (const N of SUPPORTED_GRID_SIZES) {
      const totalPieces = N * N;
      for (let i = 0; i < totalPieces; i++) {
        const rect = calculatePieceRect(TARGET_SIZE, TARGET_SIZE, N, i);
        const pieceNumStr = String(i).padStart(2, "0");
        const tilePath = `${slug}/pieces/${N}x${N}/${pieceNumStr}.webp`;

        tileTasks.push(async () => {
          const tileBuffer = await masterSharp
            .clone()
            .extract({
              left: rect.x0,
              top: rect.y0,
              width: rect.width,
              height: rect.height,
            })
            .webp({ quality: 85 })
            .toBuffer();

          const { error: tileErr } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(tilePath, tileBuffer, {
              contentType: "image/webp",
              upsert: true,
            });

          if (tileErr) {
            throw new Error(`Tile upload failed at ${tilePath}: ${tileErr.message}`);
          }

          // Flat path for legacy 4x4 compatibility
          if (N === 4) {
            const flatPath = `${slug}/pieces/${pieceNumStr}.webp`;
            await supabaseAdmin.storage
              .from(BUCKET_NAME)
              .upload(flatPath, tileBuffer, {
                contentType: "image/webp",
                upsert: true,
              });
          }
        });
      }
    }

    console.log(
      `[HOST_PUZZLE_UPLOAD_PROCESSING] requestId=${requestId} totalTiles=${tileTasks.length} batchSize=${BATCH_SIZE}`,
    );

    // Execute with bounded concurrency to prevent memory spikes and socket exhaustion
    await runBatched(tileTasks, BATCH_SIZE);

    // 5. Insert Row into puzzle_images Table
    stage = "DATABASE METADATA";
    const { data: dbRow, error: dbErr } = await supabaseAdmin
      .from("puzzle_images")
      .insert({
        name,
        storage_path: slug,
        mime_type: "image/webp",
        width: TARGET_SIZE,
        height: TARGET_SIZE,
        grid_rows: 4,
        grid_columns: 4,
        active: true,
      })
      .select("id, created_at")
      .single();

    if (dbErr) {
      console.error(`[HOST_PUZZLE_UPLOAD_ERROR] requestId=${requestId} stage=METADATA error=${dbErr.message}`);
      return NextResponse.json(
        { error: "DB_ERROR", message: "Failed to register puzzle image in database" },
        { status: 500 },
      );
    }

    console.log(`[HOST_PUZZLE_UPLOAD_METADATA] requestId=${requestId} puzzleId=${dbRow.id}`);

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/puzzle-images/${originalPath}`;

    // Register in dynamic in-memory service
    imageService.registerDynamicImage({
      id: dbRow.id,
      slug,
      url: publicUrl,
      name,
    });

    const puzzle: PuzzleImageDef = {
      id: dbRow.id,
      name,
      slug,
      url: publicUrl,
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      supportedGrids: [2, 3, 4, 5, 6, 7, 8],
      active: true,
      createdAt: new Date(dbRow.created_at).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      usageCount: 0,
    };

    const duration = Math.round(performance.now() - startTime);
    console.log(
      `[HOST_PUZZLE_UPLOAD_SUCCESS] requestId=${requestId} duration=${duration}ms puzzleId=${puzzle.id} slug=${slug}`,
    );

    return NextResponse.json({ ok: true, puzzle }, { status: 201 });
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    console.error(
      `[HOST_PUZZLE_UPLOAD_ERROR] requestId=${requestId} stage=${stage} duration=${duration}ms error=${err?.message}`,
    );
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err?.message ?? "Failed to upload puzzle image" },
      { status: 500 },
    );
  }
}
