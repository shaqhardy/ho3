import type { SupabaseClient } from "@supabase/supabase-js";

const TRANSFER_PFC = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);

// Backup rule only. Confirmed with Shaq: distributions land as direct ACH
// from the LLC bank, not through a payroll provider. Kept in case the flow
// ever changes (future-proofing) or a client ever pays via one of these.
const PAYROLL_PROVIDER_PATTERNS = [
  "gusto",
  "adp",
  "paychex",
  "rippling",
  "onpay",
  "quickbooks payroll",
  "wave payroll",
  "square payroll",
  "justworks",
];

export type IncomeClassification =
  | "external_income"
  | "owner_distribution"
  | "internal_transfer";

export type Book = "personal" | "business" | "nonprofit";

export interface ClassifyIncomeInput {
  transactionId: string;
  accountId: string | null;
  book: Book;
  amount: number;
  date: string; // YYYY-MM-DD
  merchant: string | null;
  pfcPrimary: string | null;
}

export interface ClassifyIncomeResult {
  classification: IncomeClassification;
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

interface Counterpart {
  txnId: string;
  accountId: string | null;
  book: Book;
}

async function findCounterpartDebit(
  admin: SupabaseClient,
  input: ClassifyIncomeInput
): Promise<Counterpart | null> {
  const lo = shiftDate(input.date, -3);
  const hi = shiftDate(input.date, 3);
  const penny = 0.01;

  const { data } = await admin
    .from("transactions")
    .select("id, account_id, book, amount, date")
    .eq("is_income", false)
    .gte("date", lo)
    .lte("date", hi)
    .gte("amount", input.amount - penny)
    .lte("amount", input.amount + penny)
    .neq("id", input.transactionId)
    .limit(5);

  const filtered = (data ?? []).filter(
    (t) => !input.accountId || t.account_id !== input.accountId
  );
  if (filtered.length === 0) return null;
  return {
    txnId: filtered[0].id as string,
    accountId: (filtered[0].account_id as string | null) ?? null,
    book: filtered[0].book as Book,
  };
}

async function lookupTransactionBook(
  admin: SupabaseClient,
  transactionId: string
): Promise<Book | null> {
  const { data } = await admin
    .from("transactions")
    .select("book")
    .eq("id", transactionId)
    .maybeSingle();
  return (data?.book as Book | undefined) ?? null;
}

function matchesPayrollMerchant(merchant: string | null): boolean {
  if (!merchant) return false;
  const m = merchant.toLowerCase();
  return PAYROLL_PROVIDER_PATTERNS.some((p) => m.includes(p));
}

/**
 * Auto-classify an income credit. Implements the 5-rule chain from the
 * Cash/Income/Combined spec §6d. Rule 3 (ACH counterpart debit on another
 * book) is the primary detector for owner distributions since Plaid often
 * won't tag cross-institution ACH as TRANSFER_*. Rule 4 (payroll merchant)
 * is backup only — Shaq's current flow is direct ACH, no payroll provider.
 *
 * Never auto-suppresses. The entry is always inserted as unconfirmed so the
 * user can review and correct.
 */
export async function classifyIncome(
  admin: SupabaseClient,
  input: ClassifyIncomeInput
): Promise<ClassifyIncomeResult> {
  // Look up any existing bridge_link first — it's the authoritative manual
  // pairing and should outrank Plaid's auto-tag if a human ever linked them.
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
        ? (bridge.personal_transaction_id as string)
        : (bridge.business_transaction_id as string);
    const otherBook = await lookupTransactionBook(admin, otherId);
    const sameBook = otherBook !== null && otherBook === input.book;
    return {
      classification: sameBook ? "internal_transfer" : "owner_distribution",
      likelyTransfer: sameBook,
      matchTransactionId: otherId,
    };
  }

  const counterpart = await findCounterpartDebit(admin, input);

  // Rules 1 & 2: Plaid tagged the credit as a transfer. Distinguish
  // same-book (internal) vs. cross-book (owner distribution) via counterpart.
  if (input.pfcPrimary && TRANSFER_PFC.has(input.pfcPrimary)) {
    if (counterpart) {
      const sameBook = counterpart.book === input.book;
      return {
        classification: sameBook ? "internal_transfer" : "owner_distribution",
        likelyTransfer: sameBook,
        matchTransactionId: counterpart.txnId,
      };
    }
    // Plaid said transfer but we can't find the other leg. Err on
    // internal_transfer — Plaid has high precision on this tag.
    return {
      classification: "internal_transfer",
      likelyTransfer: true,
      matchTransactionId: null,
    };
  }

  // Rule 3: counterpart debit on another book = owner distribution. This is
  // the primary path for Shaq's ACH-out-of-LLC → ACH-in-to-personal flow.
  if (counterpart) {
    const sameBook = counterpart.book === input.book;
    return {
      classification: sameBook ? "internal_transfer" : "owner_distribution",
      likelyTransfer: sameBook,
      matchTransactionId: counterpart.txnId,
    };
  }

  // Rule 4: payroll-provider merchant match. Backup only; not expected to
  // fire in Shaq's current setup.
  if (matchesPayrollMerchant(input.merchant)) {
    return {
      classification: "owner_distribution",
      likelyTransfer: false,
      matchTransactionId: null,
    };
  }

  // Rule 5: safe default.
  return {
    classification: "external_income",
    likelyTransfer: false,
    matchTransactionId: null,
  };
}

export interface EnqueueInput {
  userId: string;
  book: Book;
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
  const result = await classifyIncome(admin, {
    transactionId: input.transactionId,
    accountId: input.accountId,
    book: input.book,
    amount: input.amount,
    date: input.date,
    merchant: input.merchant,
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
      classification: result.classification,
      likely_transfer: result.likelyTransfer,
      transfer_match_txn_id: result.matchTransactionId,
    },
    { onConflict: "linked_transaction_id", ignoreDuplicates: true }
  );
}

// Kept for backwards compatibility with any caller still importing the old
// name. The new surface is classifyIncome().
export async function detectLikelyTransfer(
  admin: SupabaseClient,
  input: {
    transactionId: string;
    accountId: string | null;
    amount: number;
    date: string;
    pfcPrimary: string | null;
    book?: Book;
  }
): Promise<{ likelyTransfer: boolean; matchTransactionId: string | null }> {
  const result = await classifyIncome(admin, {
    transactionId: input.transactionId,
    accountId: input.accountId,
    book: input.book ?? "personal",
    amount: input.amount,
    date: input.date,
    merchant: null,
    pfcPrimary: input.pfcPrimary,
  });
  return {
    likelyTransfer: result.likelyTransfer,
    matchTransactionId: result.matchTransactionId,
  };
}
