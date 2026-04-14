import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

const UNDO_WINDOW_MS = 30 * 1000;

// Soft-disconnect an entire Plaid item (bank connection).
// Plaid /item/remove is deferred until commit to preserve the 30s undo window.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { user, admin } = gate;

  const { data: item } = await admin
    .from("plaid_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!item)
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });

  const { data: accounts } = await admin
    .from("accounts")
    .select("id, name, nickname, book, current_balance, mask")
    .eq("plaid_item_id", item.plaid_item_id);
  const accountIds = (accounts ?? []).map((a) => a.id);

  let txnCount = 0;
  if (accountIds.length) {
    const { count } = await admin
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .in("account_id", accountIds);
    txnCount = count ?? 0;
  }

  const scheduledAt = new Date(Date.now() + UNDO_WINDOW_MS).toISOString();

  const { data: pending, error: pErr } = await admin
    .from("pending_deletions")
    .insert({
      user_id: user.id,
      entity_type: "plaid_item",
      entity_id: id,
      snapshot: {
        plaid_item: item,
        accounts: accounts ?? [],
        txn_count: txnCount,
      },
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
    .from("plaid_items")
    .update({ pending_delete_id: pending.id })
    .eq("id", id);
  if (accountIds.length) {
    await admin
      .from("accounts")
      .update({ is_hidden: true, pending_delete_id: pending.id })
      .in("id", accountIds);
  }

  return NextResponse.json({
    success: true,
    pending_deletion_id: pending.id,
    scheduled_purge_at: pending.scheduled_purge_at,
    account_count: accountIds.length,
    txn_count: txnCount,
  });
}
