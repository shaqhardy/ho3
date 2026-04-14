import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

const UNDO_WINDOW_MS = 30 * 1000;

// Soft-delete a single account from a multi-account Plaid item.
// Creates a pending_deletions row; /api/pending-deletions/[id]/commit does the purge.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { user, admin } = gate;

  const { data: account } = await admin
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!account)
    return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { count: txnCount } = await admin
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("account_id", id);

  const scheduledAt = new Date(Date.now() + UNDO_WINDOW_MS).toISOString();

  const { data: pending, error: pErr } = await admin
    .from("pending_deletions")
    .insert({
      user_id: user.id,
      entity_type: "account",
      entity_id: id,
      snapshot: { account, txn_count: txnCount ?? 0 },
      scheduled_purge_at: scheduledAt,
    })
    .select("id, scheduled_purge_at")
    .single();
  if (pErr || !pending)
    return NextResponse.json(
      { error: pErr?.message || "Failed to queue deletion" },
      { status: 500 }
    );

  await admin
    .from("accounts")
    .update({ is_hidden: true, pending_delete_id: pending.id })
    .eq("id", id);

  return NextResponse.json({
    success: true,
    pending_deletion_id: pending.id,
    scheduled_purge_at: pending.scheduled_purge_at,
    txn_count: txnCount ?? 0,
  });
}
