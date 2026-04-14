import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSC, type SupabaseClient } from "@supabase/supabase-js";

export async function requireAdmin(): Promise<
  | { error: NextResponse; user: null; admin: null }
  | { error: null; user: { id: string; email: string | null | undefined }; admin: SupabaseClient }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
      admin: null,
    };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Admin only" }, { status: 403 }),
      user: null,
      admin: null,
    };
  }
  const admin = createSC(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  return { error: null, user: { id: user.id, email: user.email }, admin };
}
