import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

// POST /api/accounts/[id]/snapshot
//
// Inserts today's balance snapshot for an account. Idempotent per-day: if a
// row already exists for (account_id, snapshot_date) we update it instead of
// erroring. Admin-only — the daily cron calls this once for every account.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { admin } = gate;

  const { data: account, error: accErr } = await admin
    .from("accounts")
    .select("id, current_balance, available_balance")
    .eq("id", id)
    .maybeSingle();

  if (accErr) {
    return NextResponse.json({ error: accErr.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Upsert on (account_id, snapshot_date). If a unique constraint isn't set
  // we still want the path to succeed — so try upsert first, then fall back
  // to an update/insert pair on conflict.
  const row = {
    account_id: id,
    snapshot_date: today,
    current_balance: Number(account.current_balance ?? 0),
    available_balance:
      account.available_balance === null
        ? null
        : Number(account.available_balance),
  };

  const { error: upsertErr, data: upserted } = await admin
    .from("account_balance_snapshots")
    .upsert(row, { onConflict: "account_id,snapshot_date" })
    .select()
    .maybeSingle();

  if (upsertErr) {
    // Fallback: manual update-or-insert.
    const { data: existing } = await admin
      .from("account_balance_snapshots")
      .select("id")
      .eq("account_id", id)
      .eq("snapshot_date", today)
      .maybeSingle();
    if (existing) {
      await admin
        .from("account_balance_snapshots")
        .update({
          current_balance: row.current_balance,
          available_balance: row.available_balance,
        })
        .eq("id", existing.id);
      return NextResponse.json({ success: true, updated: true });
    }
    const { error: insErr } = await admin
      .from("account_balance_snapshots")
      .insert(row);
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, inserted: true });
  }

  return NextResponse.json({ success: true, snapshot: upserted });
}
