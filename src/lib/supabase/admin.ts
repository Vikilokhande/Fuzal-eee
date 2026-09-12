// ============================================================================
// SERVER ONLY: NEVER IMPORT THIS MODULE INTO CLIENT COMPONENTS ('use client')
// Uses privileged SUPABASE_SERVICE_ROLE_KEY to bypass Row Level Security.
// ============================================================================
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("SERVER ONLY: NEXT_PUBLIC_SUPABASE_URL environment variable is required.");
}

if (!serviceRoleKey) {
  throw new Error("SERVER ONLY: SUPABASE_SERVICE_ROLE_KEY environment variable is required.");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
