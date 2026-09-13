import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import { imageService } from "@/lib/game/imageService";
import type { PuzzleImageDef } from "@/lib/game/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET_NAME = "puzzle-images";
const TARGET_SIZE = 900;
const SUPPORTED_GRID_SIZES = [2, 3, 4, 5, 6, 7, 8] as const;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

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

export async function POST(req: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "DB_NOT_CONFIGURED", message: "Supabase storage is not configured" },
        { status: 503 },
      );
    }

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
        { error: "BAD_REQUEST", message: "File size exceeds 5MB limit" },
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

    // 1. Generate master 900x900 square WebP
    let masterWebP: Buffer;
    try {
      masterWebP = await sharp(fileBuffer, { density: 200 })
        .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "center" })
        .webp({ quality: 90 })
        .toBuffer();
    } catch (err: any) {
      console.error("[SHARP_PROCESS_ERR]", err);
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Failed to process image. Ensure file is a valid image." },
        { status: 400 },
      );
    }

    const baseSlug = slugify(name);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    // 2. Upload master original to Supabase Storage
    const originalPath = `${slug}/original.webp`;
    const { error: origErr } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(originalPath, masterWebP, {
        contentType: "image/webp",
        upsert: true,
      });

    if (origErr) {
      console.error("[STORAGE_ORIG_UPLOAD_ERR]", origErr);
      return NextResponse.json(
        { error: "STORAGE_ERROR", message: `Failed to upload image to storage: ${origErr.message}` },
        { status: 500 },
      );
    }

    // 3. Pre-generate tiles for grids 2x2 through 8x8 using Sharp
    const masterSharp = sharp(masterWebP);
    const tileUploads: Promise<any>[] = [];

    for (const N of SUPPORTED_GRID_SIZES) {
      const tileWidth = Math.round(TARGET_SIZE / N);
      const tileHeight = Math.round(TARGET_SIZE / N);

      for (let i = 0; i < N * N; i++) {
        const col = i % N;
        const row = Math.floor(i / N);
        const left = col * tileWidth;
        const top = row * tileHeight;
        const width = col === N - 1 ? TARGET_SIZE - left : tileWidth;
        const height = row === N - 1 ? TARGET_SIZE - top : tileHeight;
        const pieceNumStr = String(i).padStart(2, "0");

        tileUploads.push(
          (async () => {
            const tileBuffer = await masterSharp
              .clone()
              .extract({ left, top, width, height })
              .webp({ quality: 85 })
              .toBuffer();

            const tilePath = `${slug}/pieces/${N}x${N}/${pieceNumStr}.webp`;
            await supabaseAdmin.storage
              .from(BUCKET_NAME)
              .upload(tilePath, tileBuffer, {
                contentType: "image/webp",
                upsert: true,
              });

            // Also upload flat path for 4x4 backward compatibility
            if (N === 4) {
              const flatPath = `${slug}/pieces/${pieceNumStr}.webp`;
              await supabaseAdmin.storage
                .from(BUCKET_NAME)
                .upload(flatPath, tileBuffer, {
                  contentType: "image/webp",
                  upsert: true,
                });
            }
          })(),
        );
      }
    }

    // Wait for all pre-generated slices to finish uploading
    await Promise.all(tileUploads);

    // 4. Insert row into puzzle_images table
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
      console.error("[DB_INSERT_PUZZLE_ERR]", dbErr);
      return NextResponse.json(
        { error: "DB_ERROR", message: "Failed to register puzzle image in database" },
        { status: 500 },
      );
    }

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

    return NextResponse.json({ ok: true, puzzle }, { status: 201 });
  } catch (err: any) {
    console.error("[UPLOAD_PUZZLE_IMG_ERR]", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err?.message ?? "Failed to upload puzzle image" },
      { status: 500 },
    );
  }
}
