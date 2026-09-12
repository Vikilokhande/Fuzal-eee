// ============================================================================
// SERVER ONLY: NEVER IMPORT THIS MODULE INTO CLIENT COMPONENTS ('use client')
// Uses privileged SUPABASE_SERVICE_ROLE_KEY to bypass Row Level Security.
// ============================================================================
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key";

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

