// Auto-budget math: turns N months of transaction history into a proposed
// per-category allocation for the next period. The main job of this module is
// to avoid getting suckered by outliers — a single $1,200 car-repair month
// shouldn't become a $400/mo line item on a 3-month lookback.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book, BudgetPeriodType } from "@/lib/types";

export interface GenerateInput {
  book: Book;
  lookback_months: number;
  period: BudgetPeriodType;
  round_to: number; // $25 or $50 typically
  // If true, exclude categories where the monthly median is below $5 — those
  // are usually noise (a one-off refund that shouldn't seed a budget line).
  drop_noise?: boolean;
}

export interface ProposedLine {
  category_id: string;
  category_name: string;
  monthly_total: number[]; // actual totals per calendar month, oldest → newest
  months_observed: number;
  actual_avg_per_month: number;
  trimmed_mean_per_month: number;
  proposed_per_period: number;
  proposed_per_month: number;
  reason: string;
}

export interface GenerateResult {
  lookback_months: number;
  period: BudgetPeriodType;
  round_to: number;
  lookback_from: string;
  lookback_to: string;
  lines: ProposedLine[];
  excluded: Array<{ category_name: string; reason: string }>;
}

/** A 20/20 trimmed mean: drop the top 20% and bottom 20% of months then
 *  average the middle 60%. With few months it falls back to a median, which
 *  is naturally outlier-resistant. */
export function trimmedMean(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length <= 3) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const drop = Math.floor(values.length * 0.2);
  const middle = sorted.slice(drop, sorted.length - drop);
  const sum = middle.reduce((s, x) => s + x, 0);
  return middle.length > 0 ? sum / middle.length : 0;
}

export function roundUpTo(value: number, step: number): number {
  if (step <= 0) return Math.ceil(value);
  return Math.ceil(value / step) * step;
}

function monthlyToPeriod(
  monthly: number,
  period: BudgetPeriodType
): number {
  switch (period) {
    case "weekly":
      return monthly / 4.33;
    case "biweekly":
      return monthly / 2.17;
    case "monthly":
      return monthly;
    case "quarterly":
      return monthly * 3;
    case "yearly":
      return monthly * 12;
    default:
      return monthly;
  }
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

function addMonths(d: Date, n: number): Date {
  const c = new Date(d);
  c.setMonth(c.getMonth() + n);
  return c;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Excluded PFCs: we never seed a budget line from pure transfers, loan
 *  principal payments going back to our own credit cards (those double-count
 *  with the purchases themselves), or income. Mortgage payments are treated
 *  as Housing and *are* budget-worthy. */
const SKIP_PRIMARY = new Set(["TRANSFER_IN", "TRANSFER_OUT", "INCOME"]);
const SKIP_DETAILED = new Set([
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  "BANK_FEES_OVERDRAFT_FEES",
]);

export async function generateBudget(
  admin: SupabaseClient,
  input: GenerateInput
): Promise<GenerateResult> {
  const today = new Date();
  const firstOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const fromDate = addMonths(firstOfCurrentMonth, -input.lookback_months);
  const toDate = new Date(today.getFullYear(), today.getMonth(), 0); // last day prev month
  // Use full completed months so partial current-month data doesn't skew things.
  const lookbackFrom = iso(fromDate);
  const lookbackTo = iso(toDate);

  const { data: rows } = await admin
    .from("transactions")
    .select(
      "id, book, date, amount, category_id, is_income, pfc_primary, pfc_detailed, split_parent_id, categories(id, name)"
    )
    .eq("book", input.book)
    .eq("is_income", false)
    .gte("date", lookbackFrom)
    .lte("date", lookbackTo)
    .not("category_id", "is", null);

  type Row = {
    id: string;
    date: string;
    amount: number | string;
    category_id: string;
    pfc_primary: string | null;
    pfc_detailed: string | null;
    split_parent_id: string | null;
    categories: { id: string; name: string } | null;
  };

  // When a transaction has been split, the parent still sits in the table but
  // the children carry the real categorization. Filter the parents out.
  const childParents = new Set<string>();
  for (const r of (rows ?? []) as unknown as Row[]) {
    if (r.split_parent_id) childParents.add(r.split_parent_id);
  }

  const byCategory = new Map<
    string,
    { name: string; monthTotals: Map<string, number> }
  >();
  const excluded: Array<{ category_name: string; reason: string }> = [];

  for (const r of (rows ?? []) as unknown as Row[]) {
    if (childParents.has(r.id)) continue;
    if (r.pfc_primary && SKIP_PRIMARY.has(r.pfc_primary)) continue;
    if (r.pfc_detailed && SKIP_DETAILED.has(r.pfc_detailed)) continue;
    if (!r.categories) continue;
    const cid = r.category_id;
    const key = monthKey(r.date);
    const bucket =
      byCategory.get(cid) ??
      ((): { name: string; monthTotals: Map<string, number> } => {
        const v = { name: r.categories.name, monthTotals: new Map() };
        byCategory.set(cid, v);
        return v;
      })();
    bucket.monthTotals.set(
      key,
      (bucket.monthTotals.get(key) ?? 0) + Math.abs(Number(r.amount))
    );
  }

  // Build the month axis so a category with zero-spend months still shows
  // those as 0 (important — if you spent nothing on dining for 2 of 3 months,
  // the mean should reflect that, not pretend those months didn't exist).
  const months: string[] = [];
  for (let i = input.lookback_months; i >= 1; i--) {
    const d = addMonths(firstOfCurrentMonth, -i);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }

  const lines: ProposedLine[] = [];
  for (const [categoryId, { name, monthTotals }] of byCategory) {
    const values = months.map((m) => monthTotals.get(m) ?? 0);
    const observed = values.filter((v) => v > 0).length;
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const trimmed = trimmedMean(values);

    // Categories that only show up once or twice get their max month (single
    // purchase probably shouldn't become a monthly budget).
    let baseline = trimmed;
    let reason = `${observed}/${values.length} months with spend · trimmed mean`;
    if (observed <= 1) {
      baseline = Math.max(...values);
      reason = `Only ${observed} month with spend — using max as ceiling`;
    } else if (observed === 2) {
      const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      baseline = median;
      reason = `${observed}/${values.length} months — using median`;
    }

    if (input.drop_noise !== false && baseline < 5 && avg < 5) {
      excluded.push({
        category_name: name,
        reason: `Spend too small to budget (avg ${avg.toFixed(2)}/mo)`,
      });
      continue;
    }

    const proposedMonthly = roundUpTo(baseline, input.round_to);
    const proposedPeriod = roundUpTo(
      monthlyToPeriod(baseline, input.period),
      input.round_to
    );

    lines.push({
      category_id: categoryId,
      category_name: name,
      monthly_total: values,
      months_observed: observed,
      actual_avg_per_month: avg,
      trimmed_mean_per_month: trimmed,
      proposed_per_period: proposedPeriod,
      proposed_per_month: proposedMonthly,
      reason,
    });
  }

  // Sort: largest proposed first so the user sees the heavy-hitters at top.
  lines.sort((a, b) => b.proposed_per_period - a.proposed_per_period);

  return {
    lookback_months: input.lookback_months,
    period: input.period,
    round_to: input.round_to,
    lookback_from: lookbackFrom,
    lookback_to: lookbackTo,
    lines,
    excluded,
  };
}
