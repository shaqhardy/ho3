import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { account_id, book } = await request.json();

  const { createClient: createSC } = await import("@supabase/supabase-js");
  const adminSupabase = createSC(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await adminSupabase
    .from("accounts")
    .update({ book })
    .eq("id", account_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Also update all transactions for this account to the new book
  await adminSupabase
    .from("transactions")
    .update({ book })
    .eq("account_id", account_id);

  return NextResponse.json({ success: true });
}
