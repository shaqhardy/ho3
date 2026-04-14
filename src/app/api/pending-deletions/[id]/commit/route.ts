import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth/require-admin";
import { plaidFetch } from "@/lib/plaid/api";

/**
 * Hard-delete a pending entity. Safe to call before the 30s window expires
 * (server still does the purge); the undo API refuses after `executed_at` is set.
 */
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
  if (!pd) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (pd.undone_at)
    return NextResponse.json({ error: "Already undone" }, { status: 410 });
  if (pd.executed_at)
    return NextResponse.json({ success: true, already_executed: true });

  try {
    if (pd.entity_type === "account") {
      await purgeAccount(admin, pd.entity_id);
    } else if (pd.entity_type === "plaid_item") {
      await purgePlaidItem(admin, pd.entity_id);
    }
  } catch (err) {
    console.error("[pending-deletions/commit] purge failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Purge failed" },
      { status: 500 }
    );
  }

  await admin
    .from("pending_deletions")
    .update({ executed_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ success: true });
}

async function purgeAccount(admin: SupabaseClient, accountId: string) {
  await admin.from("scenarios").delete().eq("account_id", accountId);
  // goals.linked_account_id has ON DELETE SET NULL implicit via FK; explicit clear is safer.
  await admin
    .from("goals")
    .update({ linked_account_id: null })
    .eq("linked_account_id", accountId);
  await admin.from("transactions").delete().eq("account_id", accountId);
  await admin.from("debts").delete().eq("account_id", accountId);
  await admin.from("bills").update({ account_id: null }).eq("account_id", accountId);
  await admin
    .from("subscriptions")
    .update({ account_id: null })
    .eq("account_id", accountId);
  await admin.from("accounts").delete().eq("id", accountId);
}

async function purgePlaidItem(admin: SupabaseClient, plaidItemRowId: string) {
  const { data: item } = await admin
    .from("plaid_items")
    .select("*")
    .eq("id", plaidItemRowId)
    .maybeSingle();
  if (!item) return;

  const { data: accts } = await admin
    .from("accounts")
    .select("id")
    .eq("plaid_item_id", item.plaid_item_id);
  for (const a of (accts ?? []) as { id: string }[]) {
    await purgeAccount(admin, a.id);
  }

  // Revoke at Plaid. Best-effort — don't block local purge on Plaid outage.
  try {
    await plaidFetch("/item/remove", { access_token: item.plaid_access_token });
  } catch (err) {
    console.error("[pending-deletions/commit] plaid /item/remove failed", err);
  }

  await admin.from("plaid_items").delete().eq("id", plaidItemRowId);
}
