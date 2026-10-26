import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Viewer } from "../domain/types";

/**
 * The browser gets only the project URL and the public anon key; row-level security does the
 * protecting. The service role key is never used here (hard rule 3).
 */
let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error("Supabase isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify.");
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });
  return client;
}

/** Microsoft (Entra ID) sign-in. Basic identity only: openid, profile and email. */
export async function signInWithMicrosoft() {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "azure",
    options: { scopes: "openid profile email", redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase().auth.signOut();
}

/** Links the Microsoft account to the access an admin set up, and returns who this is. */
export async function currentViewer(): Promise<Viewer | null | "no-access"> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  const { data: rows, error } = await sb.rpc("claim_app_user");
  if (error) throw error;
  const r = (rows as Record<string, any>[] | null)?.[0];
  if (!r) return "no-access";
  return { userId: r.id, name: r.name, email: r.email, role: r.role, personId: r.person_id, repCode: r.rep_code, pmCode: r.pm_code };
}
