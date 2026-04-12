import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { syncLiabilities } from "@/lib/plaid/sync-liabilities";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: plaidItems } = await adminSupabase
    .from("plaid_items")
    .select("*");

  if (!plaidItems?.length) {
    return NextResponse.json({ error: "No Plaid items found" }, { status: 404 });
  }

  const synced = await syncLiabilities(adminSupabase, plaidItems);

  return NextResponse.json({ success: true, synced });
}
