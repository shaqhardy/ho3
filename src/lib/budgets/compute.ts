import type {
  Budget,
  BudgetCategory,
  BudgetPeriodRecord,
  Transaction,
} from "@/lib/types";

/**
 * Parse a YYYY-MM-DD date string as a local Date at midnight.
 */
function parseLocalDate(d: string): Date {
  return new Date(d + "T00:00:00");
}

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Compute the current period window for a budget based on its period type
 * and period_start_date anchor.
 */
export function currentPeriodRange(
  budget: Pick<Budget, "period" | "period_start_date" | "period_end_date">,
  now: Date = new Date()
): { start: Date; end: Date } {
  const today = startOfDay(now);
  const anchor = budget.period_start_date
    ? parseLocalDate(budget.period_start_date)
    : startOfDay(now);

  switch (budget.period) {
    case "weekly": {
      const msPerDay = 1000 * 60 * 60 * 24;
      const diffDays = Math.floor(
        (today.getTime() - anchor.getTime()) / msPerDay
      );
      const periodIndex = Math.floor(diffDays / 7);
      const start = addDays(anchor, periodIndex * 7);
      const end = endOfDay(addDays(start, 6));
      return { start, end };
    }
    case "biweekly": {
      const msPerDay = 1000 * 60 * 60 * 24;
      const diffDays = Math.floor(
        (today.getTime() - anchor.getTime()) / msPerDay
      );
      const periodIndex = Math.floor(diffDays / 14);
      const start = addDays(anchor, periodIndex * 14);
      const end = endOfDay(addDays(start, 13));
      return { start, end };
    }
    case "monthly": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = endOfDay(
        new Date(today.getFullYear(), today.getMonth() + 1, 0)
      );
      return { start, end };
    }
    case "quarterly": {
      const q = Math.floor(today.getMonth() / 3);
      const start = new Date(today.getFullYear(), q * 3, 1);
      const end = endOfDay(new Date(today.getFullYear(), q * 3 + 3, 0));
      return { start, end };
    }
    case "yearly": {
      const start = new Date(today.getFullYear(), 0, 1);
      const end = endOfDay(new Date(today.getFullYear(), 11, 31));
      return { start, end };
    }
    case "custom": {
      const start = budget.period_start_date
        ? parseLocalDate(budget.period_start_date)
        : startOfDay(now);
      const end = budget.period_end_date
        ? endOfDay(parseLocalDate(budget.period_end_date))
        : endOfDay(addDays(start, 30));
      return { start, end };
    }
    default: {
      const start = startOfDay(now);
      const end = endOfDay(addDays(start, 30));
      return { start, end };
    }
  }
}

/**
 * Number of days remaining in the current period (inclusive of today).
 * Returns 0 if the period has already ended.
 */
export function daysRemainingInPeriod(
  budget: Pick<Budget, "period" | "period_start_date" | "period_end_date">,
  now: Date = new Date()
): number {
  const { end } = currentPeriodRange(budget, now);
  const today = startOfDay(now);
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.ceil(
    (endOfDay(end).getTime() - today.getTime()) / msPerDay
  );
  return Math.max(0, diff);
}

/**
 * Returns a formatted label like "Apr 1 - Apr 30" for UI display.
 */
export function formatPeriodRange(
  budget: Pick<Budget, "period" | "period_start_date" | "period_end_date">,
  now: Date = new Date()
): { startStr: string; endStr: string; label: string } {
  const { start, end } = currentPeriodRange(budget, now);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const startStr = formatISODate(start);
  const endStr = formatISODate(end);
  return { startStr, endStr, label: `${fmt(start)} - ${fmt(end)}` };
}

/**
 * Group personal-book expense transactions by category within the budget's
 * current period. Returns a map of category_id -> spent amount (positive).
 */
export function computeSpent(
  budget: Pick<Budget, "period" | "period_start_date" | "period_end_date" | "book">,
  transactions: Pick<
    Transaction,
    "amount" | "category_id" | "date" | "is_income" | "book"
  >[]
): Map<string, number> {
  const { start, end } = currentPeriodRange(budget);
  const startTs = start.getTime();
  const endTs = end.getTime();
  const spent = new Map<string, number>();

  for (const t of transactions) {
    if (t.book !== budget.book) continue;
    if (t.is_income) continue;
    if (!t.category_id) continue;
    const dt = parseLocalDate(t.date).getTime();
    if (dt < startTs || dt > endTs) continue;
    // Expense amounts may be stored negative in some schemas; normalize to positive
    const amt = Math.abs(Number(t.amount) || 0);
    spent.set(t.category_id, (spent.get(t.category_id) || 0) + amt);
  }

  return spent;
}

/**
 * If rollover is enabled for the category, returns the unspent amount from
 * the most recent closed period. Otherwise returns 0.
 */
export function computeRolloverAmount(
  _budget: Pick<Budget, "id">,
  category: Pick<BudgetCategory, "rollover" | "allocated_amount" | "category_id">,
  previousPeriods: BudgetPeriodRecord[]
): number {
  if (!category.rollover) return 0;
  const closed = previousPeriods.filter((p) => p.status === "closed");
  if (closed.length === 0) return 0;
  const sorted = [...closed].sort((a, b) =>
    b.period_end.localeCompare(a.period_end)
  );
  const last = sorted[0];
  const proportion =
    last.total_allocated > 0
      ? category.allocated_amount / last.total_allocated
      : 0;
  const unspent = Math.max(
    0,
    last.total_allocated - last.total_spent
  );
  return unspent * proportion;
}
