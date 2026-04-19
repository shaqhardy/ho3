import type { SupabaseClient } from "@supabase/supabase-js";

const TRANSFER_PFC = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);

export interface TransferHeuristicInput {
  transactionId: string;
  accountId: string | null;
  amount: number;
  date: string; // YYYY-MM-DD
  pfcPrimary: string | null;
}

export interface TransferHeuristicResult {
  likelyTransfer: boolean;
  matchTransactionId: string | null;
}

function shiftDate(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * Decide whether a credit transaction is a likely internal transfer. We
 * never auto-suppress — the flag goes on the unconfirmed income_entry so
 * Shaq sees it in the widget and one-click dismisses.
 *
 * Signals, any of which sets likelyTransfer = true:
 *   1. Plaid personal_finance_category is TRANSFER_IN or TRANSFER_OUT
 *   2. An existing bridge_link references this transaction
 *   3. A matching debit exists on another connected account within $0.01
 *      and ±3 days (same user, opposite direction).
 */
export async function detectLikelyTransfer(
  admin: SupabaseClient,
  input: TransferHeuristicInput
): Promise<TransferHeuristicResult> {
  if (input.pfcPrimary && TRANSFER_PFC.has(input.pfcPrimary)) {
    return { likelyTransfer: true, matchTransactionId: null };
  }

  const { data: bridge } = await admin
    .from("bridge_links")
    .select("business_transaction_id, personal_transaction_id")
    .or(
      `business_transaction_id.eq.${input.transactionId},personal_transaction_id.eq.${input.transactionId}`
    )
    .maybeSingle();
  if (bridge) {
    const otherId =
      bridge.business_transaction_id === input.transactionId
        ? bridge.personal_transaction_id
        : bridge.business_transaction_id;
    return { likelyTransfer: true, matchTransactionId: otherId ?? null };
  }

  // Counterpart debit scan. Cheap: indexed on (date) already, narrow date band.
  const lo = shiftDate(input.date, -3);
  const hi = shiftDate(input.date, 3);
  const penny = 0.01;
  const amtLo = input.amount - penny;
  const amtHi = input.amount + penny;

  let q = admin
    .from("transactions")
    .select("id, account_id, amount, date, is_income")
    .eq("is_income", false)
    .gte("date", lo)
    .lte("date", hi)
    .gte("amount", amtLo)
    .lte("amount", amtHi)
    .neq("id", input.transactionId)
    .limit(5);
  if (input.accountId) q = q.neq("account_id", input.accountId);

  const { data: candidates } = await q;
  if (candidates && candidates.length > 0) {
    return { likelyTransfer: true, matchTransactionId: candidates[0].id };
  }

  return { likelyTransfer: false, matchTransactionId: null };
}

export interface EnqueueInput {
  userId: string;
  book: "personal" | "business" | "nonprofit";
  accountId: string | null;
  transactionId: string;
  amount: number;
  date: string;
  merchant: string | null;
  pfcPrimary: string | null;
}

/**
 * Create an unconfirmed income_entry for a Plaid-sourced credit. Idempotent:
 * a unique constraint on (linked_transaction_id) makes re-runs no-ops, so
 * user-confirmed entries are never clobbered by a second sync.
 */
export async function enqueueUnconfirmedIncome(
  admin: SupabaseClient,
  input: EnqueueInput
): Promise<void> {
  const heuristic = await detectLikelyTransfer(admin, {
    transactionId: input.transactionId,
    accountId: input.accountId,
    amount: input.amount,
    date: input.date,
    pfcPrimary: input.pfcPrimary,
  });

  await admin.from("income_entries").upsert(
    {
      user_id: input.userId,
      book: input.book,
      account_id: input.accountId,
      amount: input.amount,
      received_date: input.date,
      source: input.merchant,
      category: "other",
      linked_transaction_id: input.transactionId,
      is_confirmed: false,
      likely_transfer: heuristic.likelyTransfer,
      transfer_match_txn_id: heuristic.matchTransactionId,
    },
    { onConflict: "linked_transaction_id", ignoreDuplicates: true }
  );
}
