import type { SupabaseClient } from "@supabase/supabase-js";
import { plaidFetch } from "@/lib/plaid/api";
import { advanceDueDate } from "@/lib/bills/recurrence";

// Plaid's /transactions/recurring/get returns two lists:
//   - inflow_streams (income)
//   - outflow_streams (bills, subscriptions, etc.)
// Each stream has: stream_id, description, merchant_name, category,
//   personal_finance_category (primary/detailed), average_amount,
//   last_amount, last_date, predicted_next_date, frequency
//   (WEEKLY/BIWEEKLY/MONTHLY/SEMI_MONTHLY/ANNUALLY/UNKNOWN), is_active.
//
// We consume outflow_streams and upsert them into the `bills` table with
// `biller = merchant_name`, `variable = !is_stable_amount`. The unique
// dedupe key is (book, biller) so re-running this over time updates the
// existing row rather than inserting duplicates.

type PlaidAmount = { amount: number };
type PlaidStream = {
  stream_id: string;
  account_id: string;
  description: string;
  merchant_name?: string | null;
  category_id?: string | null;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
  frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "SEMI_MONTHLY" | "ANNUALLY" | "UNKNOWN";
  average_amount?: PlaidAmount | null;
  last_amount?: PlaidAmount | null;
  last_date?: string | null;
  predicted_next_date?: string | null;
  is_active: boolean;
  is_user_modified?: boolean;
};

function plaidFreqToHo3(
  f: PlaidStream["frequency"]
): "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | null {
  switch (f) {
    case "WEEKLY":
      return "weekly";
    case "BIWEEKLY":
    case "SEMI_MONTHLY":
      return "biweekly";
    case "MONTHLY":
      return "monthly";
    case "ANNUALLY":
      return "yearly";
    default:
      return null;
  }
}

type Book = "personal" | "business" | "nonprofit";

interface ImportItem {
  id: string;
  plaid_access_token: string;
  plaid_item_id: string;
}

/**
 * Pull recurring outflows from Plaid and upsert bills. Marks created rows
 * with notes "auto-detected from Plaid" so the UI can badge them and the
 * user can delete/ignore them.
 *
 * Safe to call repeatedly — dedupes on (book, biller, lifecycle='active').
 */
export async function importRecurringBills(
  admin: SupabaseClient,
  items: ImportItem[]
): Promise<{
  streams_seen: number;
  bills_created: number;
  bills_updated: number;
}> {
  let streams_seen = 0;
  let bills_created = 0;
  let bills_updated = 0;

  for (const item of items) {
    const { ok, data } = await plaidFetch<{
      inflow_streams?: PlaidStream[];
      outflow_streams?: PlaidStream[];
      error_code?: string;
      error_message?: string;
    }>("/transactions/recurring/get", {
      access_token: item.plaid_access_token,
    });
    if (!ok) {
      console.error(
        "[recurring] plaid error",
        data.error_code,
        data.error_message
      );
      continue;
    }
    const streams = (data.outflow_streams ?? []).filter(
      (s) => s.is_active && s.frequency !== "UNKNOWN"
    );
    streams_seen += streams.length;

    // Resolve the book per Plaid account (Plaid streams carry account_id).
    const accountIds = [...new Set(streams.map((s) => s.account_id))];
    const { data: acctRows } = await admin
      .from("accounts")
      .select("id, plaid_account_id, book, type")
      .in("plaid_account_id", accountIds);
    const acctMeta = new Map<string, { id: string; book: Book; type: string }>();
    for (const a of (acctRows ?? []) as Array<{
      id: string;
      plaid_account_id: string;
      book: Book;
      type: string;
    }>) {
      acctMeta.set(a.plaid_account_id, { id: a.id, book: a.book, type: a.type });
    }

    for (const s of streams) {
      const acct = acctMeta.get(s.account_id);
      if (!acct) continue;
      // Skip streams originating from credit/loan accounts — those are the
      // actual charges, not monthly bills from our perspective.
      if (acct.type === "credit" || acct.type === "loan") continue;

      const freq = plaidFreqToHo3(s.frequency);
      if (!freq) continue;

      const biller = (s.merchant_name || s.description || "").trim();
      if (!biller) continue;

      const avgAmt = Math.abs(Number(s.average_amount?.amount ?? 0));
      const lastAmt = Math.abs(Number(s.last_amount?.amount ?? 0));
      const isStable = avgAmt > 0 && Math.abs(avgAmt - lastAmt) < avgAmt * 0.05;

      // Next due: trust predicted_next_date; fall back to advancing last_date
      // by one frequency cycle.
      let nextDue =
        s.predicted_next_date ||
        (s.last_date
          ? advanceDueDate(s.last_date, freq, true, null) ?? s.last_date
          : null);
      if (!nextDue) continue;
      // If Plaid predicts a next date in the past, bump forward once.
      const today = new Date().toISOString().slice(0, 10);
      while (nextDue && nextDue < today) {
        const bumped = advanceDueDate(nextDue, freq, true, null);
        if (!bumped || bumped === nextDue) break;
        nextDue = bumped;
      }

      // Dedupe on (book, biller, lifecycle='active').
      const { data: existingBill } = await admin
        .from("bills")
        .select("id, variable, amount, typical_amount, account_id")
        .eq("book", acct.book)
        .eq("biller", biller)
        .eq("lifecycle", "active")
        .maybeSingle();

      const payload = {
        book: acct.book,
        name: biller,
        biller,
        variable: !isStable,
        amount: isStable ? avgAmt : null,
        typical_amount: avgAmt,
        due_date: nextDue,
        is_recurring: true,
        frequency: freq,
        account_id: acct.id,
        priority_tier: "2" as const,
        lifecycle: "active" as const,
        status: "upcoming" as const,
        notes: "Auto-detected from Plaid recurring transactions.",
      };

      if (existingBill) {
        await admin
          .from("bills")
          .update({
            typical_amount: avgAmt,
            amount: isStable ? avgAmt : null,
            variable: !isStable,
            account_id: acct.id,
            frequency: freq,
            due_date: nextDue,
          })
          .eq("id", existingBill.id);
        bills_updated++;
      } else {
        const { error } = await admin.from("bills").insert(payload);
        if (!error) bills_created++;
      }
    }
  }

  return { streams_seen, bills_created, bills_updated };
}
