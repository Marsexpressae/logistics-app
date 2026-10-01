import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createMockClient } from "./mock-supabase";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Supabase now calls this the "publishable" key; the older name "anon" is still accepted.
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// Without keys in .env.local the app runs against an in-browser mock with sample data.
export const isMock = !supabaseConfigured;

export const supabase: SupabaseClient = supabaseConfigured
  ? createClient(url!, anonKey!)
  : (createMockClient() as unknown as SupabaseClient);
