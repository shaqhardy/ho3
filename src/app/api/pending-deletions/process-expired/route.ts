import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth/require-admin";
import { plaidFetch } from "@/lib/plaid/api";

// Safety net: purge any pending_deletions whose undo window expired without
// a client-side commit. Called on /accounts page load + once-daily from cron.
export async function POST() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { admin } = gate;

  const now = new Date().toISOString();
  const { data: rows } = await admin
    .from("pending_deletions")
    .select("*")
    .is("executed_at", null)
    .is("undone_at", null)
    .lt("scheduled_purge_at", now);

  let purged = 0;
  for (const pd of (rows ?? []) as Array<{
    id: string;
    entity_type: string;
    entity_id: string;
  }>) {
    try {
      if (pd.entity_type === "account") await purgeAccount(admin, pd.entity_id);
      if (pd.entity_type === "plaid_item")
        await purgePlaidItem(admin, pd.entity_id);
      await admin
        .from("pending_deletions")
        .update({ executed_at: new Date().toISOString() })
        .eq("id", pd.id);
      purged++;
    } catch (err) {
      console.error("[process-expired] purge failed", pd.id, err);
    }
  }

  return NextResponse.json({ success: true, purged });
}

async function purgeAccount(admin: SupabaseClient, accountId: string) {
  await admin.from("scenarios").delete().eq("account_id", accountId);
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

  try {
    await plaidFetch("/item/remove", {
      access_token: item.plaid_access_token,
    });
  } catch (err) {
    console.error("[process-expired] plaid /item/remove failed", err);
  }

  await admin.from("plaid_items").delete().eq("id", plaidItemRowId);
}
