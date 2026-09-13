import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/admin";
import type { PuzzleImageDef } from "@/lib/game/types";

export const dynamic = "force-dynamic";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://dewdcxssvkvbgyyenmmu.supabase.co";

export async function GET(req: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ puzzles: [] });
    }

    // 1. Fetch images from database
    const { data: imgRows, error: imgErr } = await supabaseAdmin
      .from("puzzle_images")
      .select("id, name, storage_path, active, created_at, width, height")
      .order("created_at", { ascending: false });

    if (imgErr) {
      console.error("[PUZZLES_LIST_ERR]", imgErr);
      return NextResponse.json({ error: imgErr.message }, { status: 500 });
    }

    // 2. Fetch usage counts from games table
    const { data: usageRows } = await supabaseAdmin
      .from("games")
      .select("image_id");

    const usageMap = new Map<string, number>();
    if (usageRows) {
      for (const r of usageRows) {
        if (r.image_id) {
          usageMap.set(r.image_id, (usageMap.get(r.image_id) ?? 0) + 1);
        }
      }
    }

    const puzzles: PuzzleImageDef[] = (imgRows ?? []).map((row: any) => {
      const slug = row.storage_path ?? row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const url = `${supabaseUrl}/storage/v1/object/public/puzzle-images/${slug}/original.webp`;
      return {
        id: row.id,
        name: row.name,
        slug,
        url,
        width: row.width ?? 800,
        height: row.height ?? 800,
        supportedGrids: [2, 3, 4, 5, 6, 7, 8],
        active: Boolean(row.active),
        createdAt: new Date(row.created_at).toLocaleDateString("en-US", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        usageCount: usageMap.get(row.id) ?? 0,
      };
    });

    return NextResponse.json({ puzzles });
  } catch (err: any) {
    console.error("[PUZZLES_GET_ERR]", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err?.message ?? "Failed to list puzzles" },
      { status: 500 },
    );
  }
}
