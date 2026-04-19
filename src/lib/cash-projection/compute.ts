import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Book,
  IncomeClassification,
} from "@/lib/types";
import {
  computeOccurrences,
} from "@/lib/distribution-schedules/occurrences";
import type { CashWindow } from "./window";
import {
  expectedBudgetExpenses,
  type BudgetCategoryRow,
  type BudgetRow,
} from "./budget-allocations";

export type CashMode = "live" | "scheduled" | "projected";

export const CASH_MODES: readonly CashMode[] = [
  "live",
  "scheduled",
  "projected",
] as const;

const TERMINAL_BILL_STATUSES = new Set(["paid", "skipped"]);

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function minYmd(a: string, b: string): string {
  return a < b ? a : b;
}

function maxYmd(a: string, b: string): string {
  return a > b ? a : b;
}

export interface CashProjectionInput {
  books: Book[];
  isOverview: boolean;
  windowStart: string;
  windowEnd: string;
  windowRolls: "forward" | "backward";
  windowLabel: string;
  window: CashWindow;
  mode: CashMode;
}

export interface CashProjectionOutput {
  cash: {
    amount: number;
    starting_balance: number;
    source_breakdown: Record<string, number>;
  };
  income: {
    amount: number;
    past_portion_confirmed: number;
    future_portion_projected: number;
    breakdown_by_classification: Record<IncomeClassification, number>;
  };
  combined: {
    amount: number;
    is_deficit: boolean;
  };
  expected_expenses: {
    bills_total: number;
    budget_allocations_total: number;
    posted_expenses_total: number;
    owner_distribution_outflows: number;
    deduplicated_total: number;
  };
  window: {
    start: string;
    end: string;
    label: string;
  };
  mode: CashMode;
  book_scope: string;
}

export async function computeCashProjection(
  admin: SupabaseClient,
  input: CashProjectionInput
): Promise<CashProjectionOutput> {
  const today = todayYmd();
  const { books, isOverview, windowStart, windowEnd, mode } = input;
  const isBackward = input.windowRolls === "backward";

  const pastStart = windowStart;
  const pastEnd = isBackward ? windowEnd : minYmd(today, windowEnd);
  const futureStart = isBackward ? windowEnd : maxYmd(today, windowStart);
  const futureEnd = windowEnd;

  const [
    accountsRes,
    billsRes,
    incomeEntriesRes,
    projectedIncomeRes,
    transactionsRes,
    budgetsRes,
    budgetCatsRes,
    schedulesRes,
    categoriesRes,
  ] = await Promise.all([
    admin
      .from("accounts")
      .select("id, book, type, current_balance, available_balance, is_hidden")
      .in("book", books),
    admin
      .from("bills")
      .select(
        "id, book, name, amount, typical_amount, variable, due_date, status, lifecycle, category_id, account_id"
      )
      .in("book", books)
      .gte("due_date", windowStart)
      .lte("due_date", windowEnd),
    admin
      .from("income_entries")
      .select(
        "id, book, amount, received_date, classification, is_confirmed"
      )
      .in("book", books)
      .eq("is_confirmed", true)
      .not("received_date", "is", null)
      .gte("received_date", pastStart)
      .lte("received_date", pastEnd),
    admin
      .from("projected_income")
      .select("id, book, date, amount, classification, linked_schedule_id")
      .in("book", books)
      .gte("date", isBackward ? pastStart : futureStart)
      .lte("date", isBackward ? pastEnd : futureEnd),
    // Posted expenses in window — used by Live mode for the Combined box
    // and by Scheduled mode as part of expected expenses.
    admin
      .from("transactions")
      .select("id, book, amount, date, is_income, split_parent_id")
      .in("book", books)
      .eq("is_income", false)
      .gte("date", pastStart)
      .lte("date", pastEnd),
    admin
      .from("budgets")
      .select(
        "id, book, period, period_start_date, period_end_date, is_active"
      )
      .in("book", books)
      .eq("is_active", true),
    // budget_categories read is joined via the budgets filter below
    admin.from("budget_categories").select("id, budget_id, category_id, allocated_amount"),
    // Distribution schedules — used to compute source-side owner
    // distribution outflows for the Projected Cash box.
    admin
      .from("distribution_schedules")
      .select(
        "id, user_id, source_book, target_book, amount, cadence, anchor_date, custom_days, is_active"
      )
      .eq("is_active", true),
    // Fetch transactions in current month for budget spent-this-month map.
    admin
      .from("transactions")
      .select("id, book, amount, date, is_income, category_id, split_parent_id")
      .in("book", books)
      .eq("is_income", false)
      .gte("date", today.slice(0, 7) + "-01")
      .lte("date", today.slice(0, 7) + "-31"),
  ]);

  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (billsRes.error) throw new Error(billsRes.error.message);
  if (incomeEntriesRes.error) throw new Error(incomeEntriesRes.error.message);
  if (projectedIncomeRes.error) throw new Error(projectedIncomeRes.error.message);
  if (transactionsRes.error) throw new Error(transactionsRes.error.message);
  if (budgetsRes.error) throw new Error(budgetsRes.error.message);
  if (budgetCatsRes.error) throw new Error(budgetCatsRes.error.message);
  if (schedulesRes.error) throw new Error(schedulesRes.error.message);

  const accounts = accountsRes.data ?? [];
  const bills = billsRes.data ?? [];
  const incomeEntries = incomeEntriesRes.data ?? [];
  const projectedIncome = projectedIncomeRes.data ?? [];
  const transactions = transactionsRes.data ?? [];
  const budgets = (budgetsRes.data ?? []) as BudgetRow[];
  const budgetCategories = (budgetCatsRes.data ?? []) as BudgetCategoryRow[];
  const schedules = schedulesRes.data ?? [];
  const currentMonthTxns = categoriesRes.data ?? [];

  // --- Cash: sum depository balances, skip hidden accounts ---
  const sourceBreakdown: Record<string, number> = {};
  let startingBalance = 0;
  for (const a of accounts) {
    if (a.is_hidden) continue;
    if (a.type !== "depository") continue;
    const bal = Number(a.available_balance ?? a.current_balance ?? 0);
    startingBalance += bal;
    sourceBreakdown[a.id] = bal;
  }

  // --- Bills in window (unpaid, active lifecycle) ---
  type BillRow = (typeof bills)[number];
  const unpaidBills: BillRow[] = bills.filter(
    (b) =>
      !TERMINAL_BILL_STATUSES.has(b.status as string) &&
      (b.lifecycle ?? "active") === "active"
  );
  const billsTotal = unpaidBills.reduce((sum, b) => {
    const amt = Number(b.amount ?? b.typical_amount ?? 0);
    return sum + amt;
  }, 0);

  // Bill dedup map: sum of bill amounts by category_id (for the budget
  // allocation dedup per spec §5c).
  const billSumByCategory = new Map<string, number>();
  for (const b of unpaidBills) {
    if (!b.category_id) continue;
    const amt = Number(b.amount ?? b.typical_amount ?? 0);
    billSumByCategory.set(
      b.category_id,
      (billSumByCategory.get(b.category_id) ?? 0) + amt
    );
  }

  // --- Posted expenses in past portion ---
  const postedExpensesTotal = transactions
    // Exclude split parents — their children carry categorized amounts
    // (same logic as monthly_flows RPC).
    .filter(
      (t) =>
        !transactions.some(
          (c) => c.split_parent_id && c.split_parent_id === t.id
        )
    )
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // --- Income box: classification rules per book scope ---
  function classificationFilter(book: Book, classification: string): boolean {
    const cls = classification as IncomeClassification;
    if (cls === "internal_transfer") return false; // never counts anywhere
    if (isOverview) {
      // Overview excludes owner_distribution to prevent double-counting.
      return cls === "external_income";
    }
    if (book === "personal") {
      return cls === "external_income" || cls === "owner_distribution";
    }
    // Business & nonprofit: external only.
    return cls === "external_income";
  }

  const pastConfirmed = incomeEntries.filter((e) =>
    classificationFilter(e.book as Book, e.classification as string)
  );
  const pastAmount = pastConfirmed.reduce(
    (s, e) => s + Number(e.amount),
    0
  );

  let futureAmount = 0;
  const futureProjected =
    mode === "live"
      ? []
      : projectedIncome.filter((p) =>
          classificationFilter(p.book as Book, p.classification as string)
        );
  futureAmount = futureProjected.reduce((s, p) => s + Number(p.amount), 0);

  const breakdownByClassification: Record<IncomeClassification, number> = {
    external_income: 0,
    owner_distribution: 0,
    internal_transfer: 0,
  };
  for (const e of pastConfirmed) {
    breakdownByClassification[e.classification as IncomeClassification] +=
      Number(e.amount);
  }
  for (const p of futureProjected) {
    breakdownByClassification[p.classification as IncomeClassification] +=
      Number(p.amount);
  }

  const incomeAmount = pastAmount + futureAmount;

  // --- Budget allocations ---
  const spentThisMonth: Record<string, number> = {};
  for (const t of currentMonthTxns) {
    if (!t.category_id) continue;
    // Skip split parents.
    if (
      currentMonthTxns.some(
        (c) => c.split_parent_id && c.split_parent_id === t.id
      )
    )
      continue;
    spentThisMonth[t.category_id] =
      (spentThisMonth[t.category_id] ?? 0) + Math.abs(Number(t.amount));
  }

  const bookBudgetIds = new Set(budgets.map((b) => b.id));
  const scopedCategories = budgetCategories.filter((c) =>
    bookBudgetIds.has(c.budget_id)
  );
  const budgetAllocationsTotal =
    mode === "projected"
      ? expectedBudgetExpenses(
          budgets,
          scopedCategories,
          windowStart,
          windowEnd,
          today,
          spentThisMonth,
          { billSumByCategory }
        )
      : 0;

  // --- Owner distribution outflows for Projected Cash box ---
  // For per-book scope where scope includes a source_book, subtract
  // occurrences in window. On Overview, these cancel against target-side
  // owner_distribution inflows already present in projected_income, so we
  // return 0 (and Combined nets to zero on those anyway since Overview
  // income excludes owner_distribution).
  let ownerDistributionOutflows = 0;
  if (mode === "projected" && !isOverview) {
    for (const s of schedules) {
      if (!books.includes(s.source_book as Book)) continue;
      // If target is in scope too, it cancels — single book scope can never
      // have both since source_book <> target_book at the constraint level.
      if (books.includes(s.target_book as Book)) continue;
      const occ = computeOccurrences({
        cadence: s.cadence as import("@/lib/types").DistributionCadence,
        anchorDate: s.anchor_date as string,
        customDays: (s.custom_days as number[] | null) ?? null,
        from: windowStart,
        to: windowEnd,
      });
      ownerDistributionOutflows += occ.length * Number(s.amount);
    }
  }

  // --- Compose Cash + Combined per mode ---
  const deduplicatedExpenses =
    mode === "live"
      ? postedExpensesTotal
      : mode === "scheduled"
        ? billsTotal + postedExpensesTotal
        : billsTotal + budgetAllocationsTotal;

  let cashAmount = startingBalance;
  if (mode === "scheduled") {
    cashAmount = startingBalance - billsTotal;
  } else if (mode === "projected") {
    // Projected Cash box = end-of-window cash if nothing changes.
    cashAmount =
      startingBalance -
      billsTotal -
      budgetAllocationsTotal +
      futureAmount -
      ownerDistributionOutflows;
  }

  // Combined uses a consistent "delta over window" formula so the math
  // doesn't double-count bills between Cash and Expenses. Per spec intent:
  // starting cash + income during window - expenses during window.
  const combinedAmount =
    startingBalance + incomeAmount - deduplicatedExpenses - ownerDistributionOutflows;

  return {
    cash: {
      amount: round2(cashAmount),
      starting_balance: round2(startingBalance),
      source_breakdown: Object.fromEntries(
        Object.entries(sourceBreakdown).map(([k, v]) => [k, round2(v)])
      ),
    },
    income: {
      amount: round2(incomeAmount),
      past_portion_confirmed: round2(pastAmount),
      future_portion_projected: round2(futureAmount),
      breakdown_by_classification: {
        external_income: round2(breakdownByClassification.external_income),
        owner_distribution: round2(breakdownByClassification.owner_distribution),
        internal_transfer: round2(breakdownByClassification.internal_transfer),
      },
    },
    combined: {
      amount: round2(combinedAmount),
      is_deficit: combinedAmount < 0,
    },
    expected_expenses: {
      bills_total: round2(billsTotal),
      budget_allocations_total: round2(budgetAllocationsTotal),
      posted_expenses_total: round2(postedExpensesTotal),
      owner_distribution_outflows: round2(ownerDistributionOutflows),
      deduplicated_total: round2(deduplicatedExpenses + ownerDistributionOutflows),
    },
    window: {
      start: windowStart,
      end: windowEnd,
      label: input.windowLabel,
    },
    mode,
    book_scope: isOverview ? "all" : books[0],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
