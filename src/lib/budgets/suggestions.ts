import type { SupabaseClient } from "@supabase/supabase-js";
import { currentPeriodRange } from "@/lib/budgets/compute";
import { roundUpTo } from "@/lib/budgets/generate";

type PeriodType = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "custom";

interface BudgetRow {
  id: string;
  book: "personal" | "business" | "nonprofit";
  period: PeriodType;
  period_start_date: string | null;
  period_end_date: string | null;
  is_active: boolean;
  priority_tier_protected?: boolean;
}

interface BudgetCategoryRow {
  id: string;
  budget_id: string;
  category_id: string;
  allocated_amount: number | string;
  rollover: boolean;
}

/** Shift a period by -1 so we can compare the just-closed period to the
 *  current one. Very thin helper — monthly is the common case. */
function previousPeriodRange(budget: {
  period: PeriodType;
  period_start_date: string | null;
  period_end_date: string | null;
}): { start: Date; end: Date; key: string } {
  const now = new Date();
  const prev = new Date(now);
  if (budget.period === "monthly") prev.setMonth(prev.getMonth() - 1);
  else if (budget.period === "weekly") prev.setDate(prev.getDate() - 7);
  else if (budget.period === "biweekly") prev.setDate(prev.getDate() - 14);
  else if (budget.period === "quarterly") prev.setMonth(prev.getMonth() - 3);
  else if (budget.period === "yearly") prev.setFullYear(prev.getFullYear() - 1);
  const range = currentPeriodRange(budget, prev);
  const y = range.start.getFullYear();
  const m = String(range.start.getMonth() + 1).padStart(2, "0");
  const d = String(range.start.getDate()).padStart(2, "0");
  return { start: range.start, end: range.end, key: `${y}-${m}-${d}` };
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Generate "tune-up" suggestions comparing the just-closed period's actuals
 * to each category's allocated amount. Only fires suggestions that are
 * meaningfully off (>15% delta AND >$25 absolute). Idempotent per period via
 * the unique (budget_category_id, period_key) constraint.
 *
 * Critical bills are protected: we never suggest decreasing a category that
 * is the `category_id` of any bill with `priority_tier = '1'` (critical) and
 * lifecycle = 'active'. That keeps the suggestion engine from nudging the
 * user toward missing rent / mortgage / etc.
 */
export async function generateTuneUpSuggestions(
  admin: SupabaseClient
): Promise<{ budgets_checked: number; suggestions_created: number }> {
  const { data: budgets } = await admin
    .from("budgets")
    .select("id, book, period, period_start_date, period_end_date, is_active")
    .eq("is_active", true);

  let created = 0;
  let checked = 0;

  for (const b of ((budgets ?? []) as BudgetRow[])) {
    if (b.period === "custom") continue;
    checked++;

    const prev = previousPeriodRange(b);
    const startStr = isoDay(prev.start);
    const endStr = isoDay(prev.end);

    const { data: cats } = await admin
      .from("budget_categories")
      .select("id, budget_id, category_id, allocated_amount, rollover")
      .eq("budget_id", b.id);

    if (!cats || cats.length === 0) continue;

    // Critical categories: any category that backs an active, priority-1 bill.
    const { data: criticalBills } = await admin
      .from("bills")
      .select("category_id")
      .eq("book", b.book)
      .eq("lifecycle", "active")
      .eq("priority_tier", "1")
      .not("category_id", "is", null);
    const critical = new Set(
      (criticalBills ?? []).map((x) => x.category_id as string)
    );

    for (const c of cats as BudgetCategoryRow[]) {
      // Sum of expense transactions in this category over the closed period.
      const { data: txns } = await admin
        .from("transactions")
        .select("amount, split_parent_id, id")
        .eq("book", b.book)
        .eq("category_id", c.category_id)
        .eq("is_income", false)
        .gte("date", startStr)
        .lte("date", endStr);

      const childParents = new Set<string>();
      for (const t of (txns ?? []) as { id: string; split_parent_id: string | null }[]) {
        if (t.split_parent_id) childParents.add(t.split_parent_id);
      }
      const actual = (txns ?? []).reduce((sum, t) => {
        if (childParents.has(t.id as string)) return sum;
        return sum + Math.abs(Number(t.amount));
      }, 0);

      const allocated = Number(c.allocated_amount);
      if (allocated <= 0) continue;
      const delta = actual - allocated;
      const absDelta = Math.abs(delta);
      const pctDelta = absDelta / allocated;

      // Threshold: both 15% off AND $25+ absolute delta.
      if (pctDelta < 0.15 || absDelta < 25) continue;

      let reason = "";
      let proposed = allocated;

      if (delta > 0) {
        // Consistently over → propose bumping up to actual, rounded up.
        proposed = roundUpTo(actual, 25);
        reason = `Spent $${actual.toFixed(0)} vs $${allocated.toFixed(0)} budgeted (+${Math.round(pctDelta * 100)}%). Consider raising to $${proposed.toFixed(0)}.`;
      } else {
        // Consistently under → propose trimming, but never below actual + 10%
        // so the new cap still has breathing room. Also never cut critical.
        if (critical.has(c.category_id)) continue;
        proposed = roundUpTo(actual * 1.1, 25);
        if (proposed >= allocated) continue;
        reason = `Used $${actual.toFixed(0)} of $${allocated.toFixed(0)} (-${Math.round(pctDelta * 100)}%). Consider trimming to $${proposed.toFixed(0)}.`;
      }

      const { error } = await admin.from("budget_suggestions").insert({
        budget_id: b.id,
        budget_category_id: c.id,
        period_key: prev.key,
        old_amount: allocated,
        proposed_amount: proposed,
        actual_amount: actual,
        reason,
      });
      // Duplicate insert (unique constraint) → treat as no-op.
      if (!error) created++;
    }
  }

  return { budgets_checked: checked, suggestions_created: created };
}
