import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceDueDate, amountMatches } from "@/lib/bills/recurrence";

type Book = "personal" | "business" | "nonprofit";

export interface MatchTxn {
  id: string;
  date: string;
  amount: number;
  merchant: string | null;
  account_id: string | null;
}

export interface MatchedBill {
  id: string;
  name: string;
  amount: number;
  book: Book;
  due_date_period: string;
}

/**
 * Try to auto-match a Plaid-synced transaction to an active recurring bill.
 * On a hit: insert bill_payments, advance the bill's due date, and update
 * last_paid_* fields. Returns the matched bill (or null) so the caller can
 * fire a "Bill paid" push notification.
 *
 * Matching rules:
 *   - Bill must be lifecycle='active', status='upcoming', in the same book.
 *   - Due date within ±3 days of the transaction date.
 *   - Amount within tolerance (±1% for fixed, ±25% for variable — see
 *     amountMatches).
 *   - If bill.biller is set, prefer matches where the transaction merchant
 *     shares a token with the biller; otherwise fall back to amount-only.
 *   - Transaction must be an outflow (not income).
 *   - If the bill has a specific account_id, the transaction must be on it.
 *
 * Idempotent: if a bill_payments row already exists for this transaction_id,
 * this does nothing.
 */
export async function autoMatchBillForTransaction(
  admin: SupabaseClient,
  txn: MatchTxn,
  book: Book,
  isIncome: boolean
): Promise<MatchedBill | null> {
  if (isIncome) return null;
  if (!txn.account_id) return null;

  // Idempotency guard.
  const { data: existingPayment } = await admin
    .from("bill_payments")
    .select("id")
    .eq("transaction_id", txn.id)
    .maybeSingle();
  if (existingPayment) return null;

  const windowStart = addDays(txn.date, -3);
  const windowEnd = addDays(txn.date, 3);

  const { data: candidates } = await admin
    .from("bills")
    .select(
      "id, name, book, biller, amount, typical_amount, variable, due_date, due_day, frequency, is_recurring, account_id, lifecycle, status"
    )
    .eq("book", book)
    .eq("lifecycle", "active")
    .eq("status", "upcoming")
    .gte("due_date", windowStart)
    .lte("due_date", windowEnd);

  if (!candidates || candidates.length === 0) return null;

  type BillRow = (typeof candidates)[number];

  const viable = (candidates as BillRow[]).filter((b) => {
    if (b.account_id && b.account_id !== txn.account_id) return false;
    return amountMatches(txn.amount, {
      amount: b.amount,
      variable: !!b.variable,
      typical_amount: b.typical_amount,
    });
  });

  if (viable.length === 0) return null;

  // Score: prefer biller-name match, then closest due date.
  const merchant = (txn.merchant ?? "").toLowerCase();
  viable.sort((a, b) => {
    const aBiller = billerScore(a.biller, merchant);
    const bBiller = billerScore(b.biller, merchant);
    if (aBiller !== bBiller) return bBiller - aBiller;
    const aDelta = Math.abs(daysBetween(a.due_date as string, txn.date));
    const bDelta = Math.abs(daysBetween(b.due_date as string, txn.date));
    return aDelta - bDelta;
  });

  const chosen = viable[0];
  const period = chosen.due_date as string;

  const nextDue = advanceDueDate(
    period,
    chosen.frequency as "weekly" | "monthly" | "quarterly" | "yearly" | null,
    !!chosen.is_recurring,
    chosen.due_day as number | null
  );

  await admin.from("bill_payments").insert({
    bill_id: chosen.id,
    date_paid: txn.date,
    amount_paid: txn.amount,
    account_id: txn.account_id,
    transaction_id: txn.id,
    manual: false,
    note: null,
  });

  await admin
    .from("bills")
    .update({
      status: nextDue ? "upcoming" : "paid",
      last_paid_date: txn.date,
      last_paid_amount: txn.amount,
      due_date: nextDue ?? chosen.due_date,
    })
    .eq("id", chosen.id);

  return {
    id: chosen.id as string,
    name: chosen.name as string,
    amount: Number(
      chosen.variable ? chosen.typical_amount ?? chosen.amount ?? txn.amount : chosen.amount ?? txn.amount
    ),
    book,
    due_date_period: period,
  };
}

function billerScore(biller: string | null, merchant: string): number {
  if (!biller || !merchant) return 0;
  const b = biller.toLowerCase();
  if (merchant === b) return 3;
  if (merchant.includes(b) || b.includes(merchant)) return 2;
  const bTokens = b.split(/\s+/).filter((t) => t.length >= 3);
  for (const tok of bTokens) if (merchant.includes(tok)) return 1;
  return 0;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((ta - tb) / 86_400_000);
}
