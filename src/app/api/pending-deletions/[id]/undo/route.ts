import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { admin } = gate;

  const { data: pd } = await admin
    .from("pending_deletions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!pd)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (pd.executed_at)
    return NextResponse.json(
      { error: "Already purged — undo window passed" },
      { status: 410 }
    );
  if (pd.undone_at)
    return NextResponse.json({ success: true, already_undone: true });

  if (pd.entity_type === "account") {
    await admin
      .from("accounts")
      .update({ is_hidden: false, pending_delete_id: null })
      .eq("id", pd.entity_id);
  } else if (pd.entity_type === "plaid_item") {
    await admin
      .from("plaid_items")
      .update({ pending_delete_id: null })
      .eq("id", pd.entity_id);
    await admin
      .from("accounts")
      .update({ is_hidden: false, pending_delete_id: null })
      .eq("pending_delete_id", id);
  }

  await admin
    .from("pending_deletions")
    .update({ undone_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ success: true });
}
