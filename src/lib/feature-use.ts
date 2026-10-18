import { supabase } from "./supabase";

const told = new Set<string>();

/**
 * Tell the app the person tried a feature (once per feature per visit). A problem here is ignored on purpose:
 * the rewards must never get in the way of the work.
 */
export async function recordFeature(key: string): Promise<void> {
  if (told.has(key)) return;
  told.add(key);
  try {
    await supabase.rpc("record_feature_use", { p_key: key });
  } catch {}
}
