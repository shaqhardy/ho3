import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

// Plaid Link update-mode completes without a new public_token exchange —
// just clear the reauth flag and note success. The next sync will go through.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { admin } = gate;

  const { error } = await admin
    .from("plaid_items")
    .update({ needs_reauth: false, last_error: null, last_error_at: null })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
