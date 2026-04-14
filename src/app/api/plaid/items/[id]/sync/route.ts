import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { syncPlaidItemNow } from "@/lib/plaid/sync-item";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { admin } = gate;

  const { data: item } = await admin
    .from("plaid_items")
    .select(
      "id, user_id, plaid_item_id, plaid_access_token, institution_name, cursor"
    )
    .eq("id", id)
    .maybeSingle();

  if (!item)
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });

  const result = await syncPlaidItemNow(admin, item);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Sync failed", ...result },
      { status: 502 }
    );
  }
  return NextResponse.json(result);
}
