import type { SupabaseClient } from "@supabase/supabase-js";
import { plaidFetch } from "@/lib/plaid/api";
import { syncLiabilities } from "@/lib/plaid/sync-liabilities";
import { autoMatchBillForTransaction } from "@/lib/bills/auto-match";
import { enqueueUnconfirmedIncome } from "@/lib/income/detect-transfer";

type Book = "personal" | "business" | "nonprofit";

type PlaidItemRow = {
  id: string;
  user_id: string;
  plaid_item_id: string;
  plaid_access_token: string;
  institution_name: string | null;
  cursor: string | null;
};

type PFC = { primary?: string | null; detailed?: string | null };

type TxnSyncResponse = {
  added?: Array<{
    transaction_id: string;
    account_id: string;
    date: string;
    amount: number;
    name?: string;
    merchant_name?: string | null;
    personal_finance_category?: PFC | null;
  }>;
  modified?: Array<{
    transaction_id: string;
    amount: number;
    name?: string;
    merchant_name?: string | null;
    date: string;
    personal_finance_category?: PFC | null;
  }>;
  removed?: Array<{ transaction_id: string }>;
  next_cursor?: string;
  has_more?: boolean;
};

type BalancesResponse = {
  accounts?: Array<{
    account_id: string;
    balances: { current: number | null; available: number | null };
  }>;
};

/**
 * Manual per-item sync: refreshes balances and pulls latest transactions.
 * Pared-down version of `/api/plaid/sync-transactions` — no push notifications,
 * no bill-match side effects. Use for the "Sync now" button.
 */
export async function syncPlaidItemNow(
  admin: SupabaseClient,
  item: PlaidItemRow
): Promise<{
  ok: boolean;
  error?: string;
  added: number;
  modified: number;
  removed: number;
  balances_refreshed: number;
}> {
  let added = 0;
  let modified = 0;
  let removed = 0;

  // --- Transactions ---
  let cursor = item.cursor || undefined;
  let hasMore = true;
  while (hasMore) {
    const { ok, data } = await plaidFetch<TxnSyncResponse>(
      "/transactions/sync",
      {
        access_token: item.plaid_access_token,
        cursor,
        count: 500,
      }
    );
    if (!ok) {
      if (data.error_code) {
        await admin
          .from("plaid_items")
          .update({
            needs_reauth: data.error_code === "ITEM_LOGIN_REQUIRED",
            last_error: data.error_code,
            last_error_at: new Date().toISOString(),
          })
          .eq("id", item.id);
      }
      return {
        ok: false,
        error: data.error_message || data.error_code || "Plaid sync failed",
        added,
        modified,
        removed,
        balances_refreshed: 0,
      };
    }

    const { data: itemAccts } = await admin
      .from("accounts")
      .select("id, plaid_account_id, book")
      .eq("plaid_item_id", item.plaid_item_id);

    const byPlaidId = new Map<string, { id: string; book: Book }>();
    for (const a of (itemAccts ?? []) as { id: string; plaid_account_id: string; book: Book }[]) {
      byPlaidId.set(a.plaid_account_id, { id: a.id, book: a.book });
    }

    for (const t of data.added ?? []) {
      const acct = byPlaidId.get(t.account_id);
      const isIncome = t.amount < 0;
      const book = acct?.book ?? "personal";
      const absAmount = Math.abs(t.amount);
      const { data: upserted } = await admin
        .from("transactions")
        .upsert(
          {
            plaid_transaction_id: t.transaction_id,
            account_id: acct?.id ?? null,
            book,
            date: t.date,
            amount: absAmount,
            merchant: t.merchant_name || t.name || null,
            description: t.name || null,
            is_income: isIncome,
            pfc_primary: t.personal_finance_category?.primary ?? null,
            pfc_detailed: t.personal_finance_category?.detailed ?? null,
          },
          { onConflict: "plaid_transaction_id" }
        )
        .select("id")
        .maybeSingle();
      added++;

      // Auto-match against bills — no push notifications on manual sync path.
      if (upserted?.id && acct?.id) {
        await autoMatchBillForTransaction(
          admin,
          {
            id: upserted.id,
            date: t.date,
            amount: absAmount,
            merchant: t.merchant_name || t.name || null,
            account_id: acct.id,
          },
          book,
          isIncome
        );
      }

      // Queue unconfirmed income for credits. Never auto-suppresses transfers
      // — detection flags likely_transfer so Shaq can dismiss in the widget.
      if (upserted?.id && isIncome) {
        await enqueueUnconfirmedIncome(admin, {
          userId: item.user_id,
          book,
          accountId: acct?.id ?? null,
          transactionId: upserted.id,
          amount: absAmount,
          date: t.date,
          merchant: t.merchant_name || t.name || null,
          pfcPrimary: t.personal_finance_category?.primary ?? null,
        });
      }
    }

    for (const t of data.modified ?? []) {
      await admin
        .from("transactions")
        .update({
          amount: Math.abs(t.amount),
          merchant: t.merchant_name || t.name || null,
          description: t.name || null,
          date: t.date,
          is_income: t.amount < 0,
          pfc_primary: t.personal_finance_category?.primary ?? null,
          pfc_detailed: t.personal_finance_category?.detailed ?? null,
        })
        .eq("plaid_transaction_id", t.transaction_id);
      modified++;
    }

    for (const t of data.removed ?? []) {
      await admin
        .from("transactions")
        .delete()
        .eq("plaid_transaction_id", t.transaction_id);
      removed++;
    }

    cursor = data.next_cursor;
    hasMore = !!data.has_more;

    await admin
      .from("plaid_items")
      .update({ cursor })
      .eq("id", item.id);
  }

  // --- Balances ---
  const { ok: balOk, data: balData } = await plaidFetch<BalancesResponse>(
    "/accounts/get",
    { access_token: item.plaid_access_token }
  );

  let refreshed = 0;
  if (balOk && balData.accounts) {
    const now = new Date().toISOString();
    for (const acct of balData.accounts) {
      await admin
        .from("accounts")
        .update({
          current_balance: acct.balances.current ?? 0,
          available_balance: acct.balances.available,
          last_synced_at: now,
        })
        .eq("plaid_account_id", acct.account_id);
      refreshed++;
    }
  }

  // Clear reauth flag on a successful pass.
  await admin
    .from("plaid_items")
    .update({ needs_reauth: false, last_error: null, last_error_at: null })
    .eq("id", item.id);

  // Liabilities (debts) — refresh payoff projections for this item.
  try {
    await syncLiabilities(admin, [item]);
  } catch {
    // Non-fatal for manual sync.
  }

  return { ok: true, added, modified, removed, balances_refreshed: refreshed };
}
