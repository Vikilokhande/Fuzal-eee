import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isSupabaseConfigured();
  let dbStatus = "unconfigured";
  let storageStatus = "unconfigured";

  if (configured) {
    try {
      const { error: dbErr } = await supabaseAdmin.from("lobbies").select("id").limit(1);
      dbStatus = dbErr ? `error: ${dbErr.message}` : "connected";
    } catch (e: any) {
      dbStatus = `exception: ${e?.message}`;
    }

    try {
      const { error: storageErr } = await supabaseAdmin.storage.from("puzzle-images").list("", { limit: 1 });
      storageStatus = storageErr ? `error: ${storageErr.message}` : "connected";
    } catch (e: any) {
      storageStatus = `exception: ${e?.message}`;
    }
  }

  let host: string | null = null;
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
    }
  } catch {
    host = "invalid-url";
  }

  return Response.json({
    ok: configured && dbStatus === "connected" && storageStatus === "connected",
    service: "fuzal-next",
    supabase: {
      configured,
      database: dbStatus,
      storage: storageStatus,
      host,
    },
  });
}
