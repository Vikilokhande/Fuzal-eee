import { createClient } from "@supabase/supabase-js";

function sanitizeUrl(raw?: string): string {
  if (!raw) return "https://placeholder.supabase.co";
  let u = raw.trim().replace(/^['"]|['"]$/g, "");
  if (u.endsWith("/")) u = u.slice(0, -1);
  return u;
}

function sanitizeKey(raw?: string): string {
  if (!raw) return "placeholder-key";
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

const supabaseUrl = sanitizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = sanitizeKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Browser-safe Supabase client using public anon key.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
