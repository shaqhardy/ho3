import type { Book } from "@/lib/types";

export interface BudgetRow {
  id: string;
  book: Book;
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
    if (y > end.getUTCFullYear() + 1) break; // safety
  }

  return out;
}

/**
 * Compute expected budget-allocation expense for a set of active budgets
 * over a window, prorated for partial months and for the current month.
 *
 * For the current month, uses remaining allocation = max(0, allocated - spent)
 * and prorates by days-from-today-in-window / days-remaining-in-month.
 *
 * Fully past months in a backward window (e.g. YTD) are excluded because
 * posted transactions already captured what actually happened.
 *
 * Per §5c, bills assigned to a matching category are subtracted to avoid
 * double-counting — callers pass `billSumByCategory` from the bills query.
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
  const monthlyEquivalent: Map<string, number> = new Map();
  for (const cat of categories) {
    if (!cat.category_id) continue;
    const b = budgets.find((bud) => bud.id === cat.budget_id);
    if (!b || !b.is_active) continue;
    const amount = Number(cat.allocated_amount);
    if (!(amount > 0)) continue;

    // Normalize allocation to a monthly amount.
    let monthly = amount;
    switch (b.period) {
      case "weekly":
        monthly = amount * 4.345;
        break;
      case "biweekly":
        monthly = amount * 2.1725;
        break;
      case "monthly":
        monthly = amount;
        break;
      case "quarterly":
        monthly = amount / 3;
        break;
      case "yearly":
        monthly = amount / 12;
        break;
      case "custom":
      default:
        monthly = amount; // conservative: treat as monthly
        break;
    }

    const prev = monthlyEquivalent.get(cat.category_id) ?? 0;
    monthlyEquivalent.set(cat.category_id, prev + monthly);
  }

  const overlaps = monthOverlaps(windowStart, windowEnd, today);
  if (overlaps.length === 0) return 0;

  const todayD = parseYmd(today);

  let total = 0;
  for (const [categoryId, monthly] of monthlyEquivalent.entries()) {
    const billOffset = dedup.billSumByCategory.get(categoryId) ?? 0;
    for (const ov of overlaps) {
      if (ov.isFullyPast) continue; // past months already captured by txns
      if (ov.containsToday) {
        const spent = spentThisMonth[categoryId] ?? 0;
        const remainingInMonth = Math.max(0, monthly - spent);
        const daysRemainingInMonth =
          Math.floor(
            (ov.lastDay.getTime() - todayD.getTime()) / 86_400_000
          ) + 1;
        if (daysRemainingInMonth <= 0) continue;
        const daysInWindowFromToday = Math.floor(
          (ov.overlapEnd.getTime() -
            Math.max(todayD.getTime(), ov.overlapStart.getTime())) /
            86_400_000
        ) + 1;
        const fraction = Math.min(
          1,
          Math.max(0, daysInWindowFromToday / daysRemainingInMonth)
        );
        total += remainingInMonth * fraction;
      } else {
        // Fully future month: scale by overlap days / month days.
        total += monthly * (ov.overlapDays / ov.monthDays);
      }
    }
    // Subtract bill dedup for this category once (already in dollars),
    // prorated across the window's forward months proportionally.
    total -= billOffset;
  }

  return Math.max(0, total);
}
