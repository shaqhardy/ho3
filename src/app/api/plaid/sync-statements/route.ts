import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { syncStatementsForItems } from "@/lib/plaid/statements";

// Node runtime — web-push uses node crypto (used downstream via push helpers).
export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin gate.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: plaidItems } = await adminSupabase
    .from("plaid_items")
    .select(
      "id, user_id, plaid_item_id, plaid_access_token, institution_name"
    );

  if (!plaidItems?.length) {
    return NextResponse.json({ error: "No Plaid items found" }, { status: 404 });
  }

  const result = await syncStatementsForItems(adminSupabase, plaidItems);

  return NextResponse.json({ success: true, ...result });
}
