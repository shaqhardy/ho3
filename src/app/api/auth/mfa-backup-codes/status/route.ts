import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("mfa_backup_codes")
    .select("id, used_at")
    .eq("user_id", user.id);

  const total = data?.length || 0;
  const used = data?.filter((c) => c.used_at).length || 0;
  const remaining = total - used;

  return NextResponse.json({ total, used, remaining });
}
