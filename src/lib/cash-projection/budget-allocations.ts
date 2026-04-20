import type { Book } from "@/lib/types";
import type {
  DetailBudgetAllocation,
  DetailBudgetSegment,
} from "./detail-types";

export interface BudgetRow {
  id: string;
  book: Book;
  name: string;
  period: string;
  period_start_date: string | null;
  period_end_date: string | null;
  is_active: boolean;
}

export interface BudgetCategoryRow {
  id: string;
  budget_id: string;
  category_id: string | null;
  allocated_amount: number | string;
}

export interface CategorySpendMap {
  /** category_id -> amount already spent this calendar month */
  [categoryId: string]: number;
}

export interface BudgetDedup {
  /**
   * Map category_id -> sum of unpaid bills in window for that category.
   * Subtracted from the budget allocation for that category so bills
   * don't get double-counted as both bill expense AND budget allocation.
   */
  billSumByCategory: Map<string, number>;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

interface MonthOverlap {
  year: number;
  month: number; // 0-indexed
  firstDay: Date;
  lastDay: Date;
  overlapStart: Date;
  overlapEnd: Date;
  overlapDays: number;
  monthDays: number;
  containsToday: boolean;
  isFullyPast: boolean;
}

function monthOverlaps(
  windowStart: string,
  windowEnd: string,
  today: string
): MonthOverlap[] {
  const start = parseYmd(windowStart);
  const end = parseYmd(windowEnd);
  const todayD = parseYmd(today);
  if (end < start) return [];

  const out: MonthOverlap[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();

  while (true) {
    const firstDay = new Date(Date.UTC(y, m, 1));
    const monthDays = daysInMonth(y, m);
    const lastDay = new Date(Date.UTC(y, m, monthDays));

    if (firstDay > end) break;

    const overlapStart = start > firstDay ? start : firstDay;
    const overlapEnd = end < lastDay ? end : lastDay;
    const overlapDays =
      Math.floor(
        (overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000
      ) + 1;

    if (overlapDays > 0) {
      const containsToday = todayD >= firstDay && todayD <= lastDay;
      const isFullyPast = lastDay < todayD && !containsToday;
      out.push({
        year: y,
        month: m,
        firstDay,
        lastDay,
        overlapStart,
        overlapEnd,
        overlapDays,
        monthDays,
        containsToday,
        isFullyPast,
      });
    }

    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    if (y > end.getUTCFullYear() + 1) break;
  }

  return out;
}

function monthlyNormalize(period: string, amount: number): number {
  switch (period) {
    case "weekly":
      return amount * 4.345;
    case "biweekly":
      return amount * 2.1725;
    case "quarterly":
      return amount / 3;
    case "yearly":
      return amount / 12;
    case "monthly":
    case "custom":
    default:
      return amount;
  }
}

/**
 * Compute total expected budget-allocation expense in window, aggregated.
 * Kept for the fast summary path (no detail=true).
 */
export function expectedBudgetExpenses(
  budgets: BudgetRow[],
  categories: BudgetCategoryRow[],
  windowStart: string,
  windowEnd: string,
  today: string,
  spentThisMonth: CategorySpendMap,
  dedup: BudgetDedup
): number {
  const details = expectedBudgetExpensesDetailed(
    budgets,
    categories,
    windowStart,
    windowEnd,
    today,
    spentThisMonth,
    dedup
  );
  return details.reduce((s, d) => s + d.final_total, 0);
}

/**
 * Compute per-category breakdown of the budget-allocation expense. For each
 * category, emits the monthly-normalized amount, one segment per month
 * overlap in the window, subtotal before dedup, bill-dedup offset, and
 * final total. Drives the drill-down panel.
 */
export function expectedBudgetExpensesDetailed(
  budgets: BudgetRow[],
  categories: BudgetCategoryRow[],
  windowStart: string,
  windowEnd: string,
  today: string,
  spentThisMonth: CategorySpendMap,
  dedup: BudgetDedup,
  categoryNames: Map<string, string> = new Map()
): DetailBudgetAllocation[] {
  const overlaps = monthOverlaps(windowStart, windowEnd, today);
  if (overlaps.length === 0) return [];

  const todayD = parseYmd(today);
  const budgetById = new Map(budgets.map((b) => [b.id, b]));
  const out: DetailBudgetAllocation[] = [];

  for (const cat of categories) {
    if (!cat.category_id) continue;
    const b = budgetById.get(cat.budget_id);
    if (!b || !b.is_active) continue;
    const allocated = Number(cat.allocated_amount);
    if (!(allocated > 0)) continue;

    const monthly = monthlyNormalize(b.period, allocated);
    const segments: DetailBudgetSegment[] = [];
    let subtotal = 0;

    // Run-length encoding for consecutive fully-future months so the label
    // reads "May–Sep full: $4,000" instead of five separate rows.
    let runStart: MonthOverlap | null = null;
    let runCount = 0;

    const flushRun = () => {
      if (runStart && runCount > 0) {
        const label =
          runCount === 1
            ? `${MONTH_NAMES[runStart.month]} full`
            : `${MONTH_NAMES[runStart.month]}–${
                MONTH_NAMES[(runStart.month + runCount - 1) % 12]
              } full`;
        const amount = monthly * runCount;
        segments.push({ label, amount });
        subtotal += amount;
      }
      runStart = null;
      runCount = 0;
    };

    for (const ov of overlaps) {
      if (ov.isFullyPast) {
        flushRun();
        continue;
      }
      if (ov.containsToday) {
        flushRun();
        const spent = spentThisMonth[cat.category_id] ?? 0;
        const remainingInMonth = Math.max(0, monthly - spent);
        const daysRemainingInMonth =
          Math.floor(
            (ov.lastDay.getTime() - todayD.getTime()) / 86_400_000
          ) + 1;
        if (daysRemainingInMonth <= 0) continue;
        const daysInWindowFromToday =
          Math.floor(
            (ov.overlapEnd.getTime() -
              Math.max(todayD.getTime(), ov.overlapStart.getTime())) /
              86_400_000
          ) + 1;
        const fraction = Math.min(
          1,
          Math.max(0, daysInWindowFromToday / daysRemainingInMonth)
        );
        const amount = remainingInMonth * fraction;
        segments.push({
          label: `${MONTH_NAMES[ov.month]} remainder`,
          amount,
        });
        subtotal += amount;
      } else if (ov.overlapDays === ov.monthDays) {
        // Fully future + full month → collapse into a run.
        if (runStart === null) {
          runStart = ov;
          runCount = 1;
        } else if (
          ov.year === runStart.year &&
          ov.month === runStart.month + runCount
        ) {
          runCount += 1;
        } else {
          flushRun();
          runStart = ov;
          runCount = 1;
        }
      } else {
        flushRun();
        // Fully future but partial overlap (edge of window).
        const amount = monthly * (ov.overlapDays / ov.monthDays);
        segments.push({
          label: `${MONTH_NAMES[ov.month]} prorated (${ov.overlapDays}/${ov.monthDays})`,
          amount,
        });
        subtotal += amount;
      }
    }
    flushRun();

    const billDedup = dedup.billSumByCategory.get(cat.category_id) ?? 0;
    const finalTotal = Math.max(0, subtotal - billDedup);

    out.push({
      budget_id: b.id,
      budget_name: b.name,
      book: b.book,
      category_id: cat.category_id,
      category_name:
        categoryNames.get(cat.category_id) ?? null,
      monthly_allocated: monthly,
      segments,
      subtotal,
      bill_dedup_applied: billDedup,
      final_total: finalTotal,
    });
  }

  return out;
}
