import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book, IncomeClassification } from "@/lib/types";
import { computeOccurrences } from "@/lib/distribution-schedules/occurrences";
import type { CashWindow } from "./window";
import {
  expectedBudgetExpensesDetailed,
  type BudgetCategoryRow,
  type BudgetRow,
} from "./budget-allocations";
import type {
  CashProjectionDetail,
  DetailAccountRow,
  DetailBillRow,
  DetailDedupMatch,
  DetailDistributionOutflow,
  DetailIncomeLine,
  DetailOutflowLine,
} from "./detail-types";

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
  includeDetail?: boolean;
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
  detail?: CashProjectionDetail;
}

export async function computeCashProjection(
  admin: SupabaseClient,
  input: CashProjectionInput
): Promise<CashProjectionOutput> {
  const today = todayYmd();
  const { books, isOverview, windowStart, windowEnd, mode } = input;
  const isBackward = input.windowRolls === "backward";
  const includeDetail = !!input.includeDetail;

  const pastStart = windowStart;
  const pastEnd = isBackward ? windowEnd : minYmd(today, windowEnd);
  const futureStart = isBackward ? windowEnd : maxYmd(today, windowStart);
  const futureEnd = windowEnd;

  // Always select the full column surface. Extra fields are cheap, and a
  // conditional column string trips up Supabase's generic type resolver.
  const [
    accountsRes,
    billsRes,
    incomeEntriesRes,
    projectedIncomeRes,
    transactionsRes,
    budgetsRes,
    budgetCatsRes,
    schedulesRes,
    currentMonthTxnsRes,
  ] = await Promise.all([
    admin
      .from("accounts")
      .select(
        "id, book, type, name, nickname, mask, subtype, current_balance, available_balance, last_synced_at, is_hidden"
      )
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
        "id, book, amount, received_date, classification, is_confirmed, source, linked_transaction_id"
      )
      .in("book", books)
      .eq("is_confirmed", true)
      .not("received_date", "is", null)
      .gte("received_date", pastStart)
      .lte("received_date", pastEnd),
    admin
      .from("projected_income")
      .select(
        "id, book, date, amount, classification, linked_schedule_id, source"
      )
      .in("book", books)
      .gte("date", isBackward ? pastStart : futureStart)
      .lte("date", isBackward ? pastEnd : futureEnd),
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
        "id, book, name, period, period_start_date, period_end_date, is_active"
      )
      .in("book", books)
      .eq("is_active", true),
    admin
      .from("budget_categories")
      .select("id, budget_id, category_id, allocated_amount"),
    admin
      .from("distribution_schedules")
      .select(
        "id, user_id, source_book, target_book, amount, cadence, anchor_date, custom_days, is_active, notes"
      )
      .eq("is_active", true),
    admin
      .from("transactions")
      .select(
        "id, book, amount, date, is_income, category_id, split_parent_id"
      )
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
  const currentMonthTxns = currentMonthTxnsRes.data ?? [];

  // Fetch category names when detail is requested — needed for bill rows,
  // budget allocation breakdowns, and the dedup match list.
  const categoryNameMap = new Map<string, string>();
  if (includeDetail) {
    const catIds = new Set<string>();
    for (const b of bills) if (b.category_id) catIds.add(b.category_id as string);
    for (const c of budgetCategories)
      if (c.category_id) catIds.add(c.category_id as string);
    if (catIds.size > 0) {
      const { data: cats } = await admin
        .from("categories")
        .select("id, name")
        .in("id", Array.from(catIds));
      for (const c of cats ?? []) {
        categoryNameMap.set(c.id as string, c.name as string);
      }
    }
  }

  // --- Cash: sum depository balances, skip hidden accounts ---
  const sourceBreakdown: Record<string, number> = {};
  let startingBalance = 0;
  for (const a of accounts) {
    if (a.is_hidden) continue;
    if (a.type !== "depository") continue;
    const bal = Number(a.available_balance ?? a.current_balance ?? 0);
    startingBalance += bal;
    sourceBreakdown[a.id as string] = bal;
  }

  // --- Bills in window (unpaid, active lifecycle) ---
  const unpaidBills = bills.filter(
    (b) =>
      !TERMINAL_BILL_STATUSES.has(b.status as string) &&
      ((b.lifecycle as string | null) ?? "active") === "active"
  );
  const billsTotal = unpaidBills.reduce((sum, b) => {
    const amt = Number(b.amount ?? b.typical_amount ?? 0);
    return sum + amt;
  }, 0);

  // Bill dedup map: sum of bill amounts by category_id.
  const billSumByCategory = new Map<string, number>();
  for (const b of unpaidBills) {
    if (!b.category_id) continue;
    const amt = Number(b.amount ?? b.typical_amount ?? 0);
    billSumByCategory.set(
      b.category_id as string,
      (billSumByCategory.get(b.category_id as string) ?? 0) + amt
    );
  }

  // --- Posted expenses in past portion ---
  const postedExpensesTotal = transactions
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
    if (cls === "internal_transfer") return false;
    if (isOverview) return cls === "external_income";
    if (book === "personal") {
      return cls === "external_income" || cls === "owner_distribution";
    }
    return cls === "external_income";
  }

  const pastConfirmed = incomeEntries.filter((e) =>
    classificationFilter(e.book as Book, e.classification as string)
  );
  const pastExcludedOwnerDist = incomeEntries.filter(
    (e) =>
      isOverview &&
      (e.classification as string) === "owner_distribution"
  );
  const pastAmount = pastConfirmed.reduce(
    (s, e) => s + Number(e.amount),
    0
  );

  const futureProjected =
    mode === "live"
      ? []
      : projectedIncome.filter((p) =>
          classificationFilter(p.book as Book, p.classification as string)
        );
  const futureExcludedOwnerDist =
    mode === "live"
      ? []
      : projectedIncome.filter(
          (p) =>
            isOverview &&
            (p.classification as string) === "owner_distribution"
        );
  const futureAmount = futureProjected.reduce(
    (s, p) => s + Number(p.amount),
    0
  );

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
    if (
      currentMonthTxns.some(
        (c) => c.split_parent_id && c.split_parent_id === t.id
      )
    )
      continue;
    spentThisMonth[t.category_id as string] =
      (spentThisMonth[t.category_id as string] ?? 0) +
      Math.abs(Number(t.amount));
  }

  const bookBudgetIds = new Set(budgets.map((b) => b.id));
  const scopedCategories = budgetCategories.filter((c) =>
    bookBudgetIds.has(c.budget_id)
  );
  const budgetBreakdown =
    mode === "projected"
      ? expectedBudgetExpensesDetailed(
          budgets,
          scopedCategories,
          windowStart,
          windowEnd,
          today,
          spentThisMonth,
          { billSumByCategory },
          categoryNameMap
        )
      : [];
  const budgetAllocationsTotal = budgetBreakdown.reduce(
    (s, d) => s + d.final_total,
    0
  );

  // --- Owner distribution outflows + detail occurrences ---
  let ownerDistributionOutflows = 0;
  const distributionOutflowDetails: DetailDistributionOutflow[] = [];
  if (mode === "projected" && !isOverview) {
    for (const s of schedules) {
      if (!books.includes(s.source_book as Book)) continue;
      if (books.includes(s.target_book as Book)) continue;
      const occ = computeOccurrences({
        cadence: s.cadence as import("@/lib/types").DistributionCadence,
        anchorDate: s.anchor_date as string,
        customDays: (s.custom_days as number[] | null) ?? null,
        from: windowStart,
        to: windowEnd,
      });
      ownerDistributionOutflows += occ.length * Number(s.amount);
      if (includeDetail) {
        for (const date of occ) {
          distributionOutflowDetails.push({
            schedule_id: s.id as string,
            date,
            amount: Number(s.amount),
            source_book: s.source_book as Book,
            target_book: s.target_book as Book,
            notes: ((s.notes as string | null) ?? null) as string | null,
          });
        }
      }
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
    cashAmount =
      startingBalance -
      billsTotal -
      budgetAllocationsTotal +
      futureAmount -
      ownerDistributionOutflows;
  }

  const combinedAmount =
    startingBalance +
    incomeAmount -
    deduplicatedExpenses -
    ownerDistributionOutflows;

  const output: CashProjectionOutput = {
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
        owner_distribution: round2(
          breakdownByClassification.owner_distribution
        ),
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
      deduplicated_total: round2(
        deduplicatedExpenses + ownerDistributionOutflows
      ),
    },
    window: {
      start: windowStart,
      end: windowEnd,
      label: input.windowLabel,
    },
    mode,
    book_scope: isOverview ? "all" : books[0],
  };

  if (!includeDetail) return output;

  // --- Build detail payload ---
  const detailAccounts: DetailAccountRow[] = accounts
    .filter((a) => !a.is_hidden && a.type === "depository")
    .map((a) => ({
      id: a.id as string,
      book: a.book as Book,
      name: (a.name as string | null) ?? "Account",
      nickname: (a.nickname as string | null) ?? null,
      mask: (a.mask as string | null) ?? null,
      subtype: (a.subtype as string | null) ?? null,
      current_balance: Number(a.current_balance ?? 0),
      available_balance:
        a.available_balance === null ? null : Number(a.available_balance),
      last_synced_at: (a.last_synced_at as string | null) ?? null,
    }));

  const detailBills: DetailBillRow[] = unpaidBills.map((b) => ({
    id: b.id as string,
    book: b.book as Book,
    name: (b.name as string | null) ?? "Bill",
    amount: Number(b.amount ?? b.typical_amount ?? 0),
    due_date: b.due_date as string,
    status: b.status as string,
    category_id: (b.category_id as string | null) ?? null,
    category_name: b.category_id
      ? categoryNameMap.get(b.category_id as string) ?? null
      : null,
  }));

  // Inflows for Cash box: projected income entries (projected mode) and
  // past confirmed income entries (all modes, past portion).
  const inflowEntries: DetailIncomeLine[] = [];
  if (mode !== "live") {
    for (const p of futureProjected) {
      inflowEntries.push({
        kind: "projected_income",
        id: p.id as string,
        book: p.book as Book,
        date: p.date as string,
        amount: Number(p.amount),
        classification: p.classification as IncomeClassification,
        source: (p.source as string | null) ?? null,
        linked_schedule_id: (p.linked_schedule_id as string | null) ?? null,
        linked_transaction_id: null,
      });
    }
  }
  for (const e of pastConfirmed) {
    inflowEntries.push({
      kind: "income_entry",
      id: e.id as string,
      book: e.book as Book,
      date: e.received_date as string,
      amount: Number(e.amount),
      classification: e.classification as IncomeClassification,
      source: (e.source as string | null) ?? null,
      linked_schedule_id: null,
      linked_transaction_id:
        (e.linked_transaction_id as string | null) ?? null,
    });
  }
  inflowEntries.sort((a, b) => a.date.localeCompare(b.date));

  // Outflows for Cash box (Projected) or live-mode posted expenses.
  const outflowEntries: DetailOutflowLine[] = [];
  if (mode === "projected") {
    for (const b of detailBills) {
      outflowEntries.push({
        kind: "bill",
        id: b.id,
        book: b.book,
        name: b.name,
        amount: b.amount,
        date_start: b.due_date,
        date_end: null,
        category_id: b.category_id,
        category_name: b.category_name,
        schedule_id: null,
        status: b.status,
      });
    }
    for (const alloc of budgetBreakdown) {
      outflowEntries.push({
        kind: "budget_allocation",
        id: `alloc:${alloc.budget_id}:${alloc.category_id ?? "_"}`,
        book: alloc.book,
        name: alloc.category_name ?? alloc.budget_name,
        amount: alloc.final_total,
        date_start: windowStart,
        date_end: windowEnd,
        category_id: alloc.category_id,
        category_name: alloc.category_name,
        schedule_id: null,
        status: null,
      });
    }
    for (const d of distributionOutflowDetails) {
      outflowEntries.push({
        kind: "distribution_outflow",
        id: `dist:${d.schedule_id}:${d.date}`,
        book: d.source_book,
        name: d.notes ?? "Owner distribution",
        amount: d.amount,
        date_start: d.date,
        date_end: null,
        category_id: null,
        category_name: null,
        schedule_id: d.schedule_id,
        status: null,
      });
    }
  } else if (mode === "scheduled") {
    for (const b of detailBills) {
      outflowEntries.push({
        kind: "bill",
        id: b.id,
        book: b.book,
        name: b.name,
        amount: b.amount,
        date_start: b.due_date,
        date_end: null,
        category_id: b.category_id,
        category_name: b.category_name,
        schedule_id: null,
        status: b.status,
      });
    }
  } else {
    // Live: posted expenses in window (only past portion has data).
    for (const t of transactions) {
      if (
        transactions.some(
          (c) => c.split_parent_id && c.split_parent_id === t.id
        )
      )
        continue;
      outflowEntries.push({
        kind: "posted_expense",
        id: t.id as string,
        book: t.book as Book,
        name: "Posted expense",
        amount: Math.abs(Number(t.amount)),
        date_start: t.date as string,
        date_end: null,
        category_id: null,
        category_name: null,
        schedule_id: null,
        status: "posted",
      });
    }
  }
  outflowEntries.sort((a, b) => a.date_start.localeCompare(b.date_start));
  const outflowSubtotal = outflowEntries.reduce((s, e) => s + e.amount, 0);

  // Income box: past/future splits with excluded owner_dist counts for
  // Overview.
  const pastDetail: DetailIncomeLine[] = pastConfirmed.map((e) => ({
    kind: "income_entry",
    id: e.id as string,
    book: e.book as Book,
    date: e.received_date as string,
    amount: Number(e.amount),
    classification: e.classification as IncomeClassification,
    source: (e.source as string | null) ?? null,
    linked_schedule_id: null,
    linked_transaction_id: (e.linked_transaction_id as string | null) ?? null,
  }));
  const futureDetail: DetailIncomeLine[] = futureProjected.map((p) => ({
    kind: "projected_income",
    id: p.id as string,
    book: p.book as Book,
    date: p.date as string,
    amount: Number(p.amount),
    classification: p.classification as IncomeClassification,
    source: (p.source as string | null) ?? null,
    linked_schedule_id: (p.linked_schedule_id as string | null) ?? null,
    linked_transaction_id: null,
  }));

  const pastExcludedAmount = pastExcludedOwnerDist.reduce(
    (s, e) => s + Number(e.amount),
    0
  );
  const futureExcludedAmount = futureExcludedOwnerDist.reduce(
    (s, p) => s + Number(p.amount),
    0
  );

  const dedupMatches: DetailDedupMatch[] = unpaidBills
    .filter((b) => b.category_id)
    .map((b) => ({
      bill_id: b.id as string,
      bill_name: (b.name as string | null) ?? "Bill",
      bill_amount: Number(b.amount ?? b.typical_amount ?? 0),
      category_id: b.category_id as string,
      category_name:
        categoryNameMap.get(b.category_id as string) ?? "(uncategorized)",
    }));

  output.detail = {
    cash: {
      starting_balance: {
        accounts: detailAccounts,
        total: round2(startingBalance),
      },
      inflows: {
        entries: inflowEntries.map((e) => ({
          ...e,
          amount: round2(e.amount),
        })),
        subtotal: round2(
          inflowEntries.reduce((s, e) => s + e.amount, 0)
        ),
      },
      outflows: {
        entries: outflowEntries.map((e) => ({
          ...e,
          amount: round2(e.amount),
        })),
        subtotal: round2(outflowSubtotal),
      },
    },
    income: {
      past: {
        entries: pastDetail.map((e) => ({ ...e, amount: round2(e.amount) })),
        subtotal: round2(pastAmount),
        excluded_owner_distributions_count: pastExcludedOwnerDist.length,
        excluded_owner_distributions_amount: round2(pastExcludedAmount),
      },
      future: {
        entries: futureDetail.map((e) => ({
          ...e,
          amount: round2(e.amount),
        })),
        subtotal: round2(futureAmount),
        excluded_owner_distributions_count: futureExcludedOwnerDist.length,
        excluded_owner_distributions_amount: round2(futureExcludedAmount),
      },
    },
    expenses: {
      bills: detailBills.map((b) => ({ ...b, amount: round2(b.amount) })),
      bills_subtotal: round2(billsTotal),
      budget_allocations: budgetBreakdown.map((a) => ({
        ...a,
        monthly_allocated: round2(a.monthly_allocated),
        subtotal: round2(a.subtotal),
        bill_dedup_applied: round2(a.bill_dedup_applied),
        final_total: round2(a.final_total),
        segments: a.segments.map((s) => ({ ...s, amount: round2(s.amount) })),
      })),
      budget_allocations_subtotal: round2(budgetAllocationsTotal),
      distribution_outflows: distributionOutflowDetails.map((d) => ({
        ...d,
        amount: round2(d.amount),
      })),
      distribution_outflows_subtotal: round2(ownerDistributionOutflows),
      dedup_applied: dedupMatches.map((d) => ({
        ...d,
        bill_amount: round2(d.bill_amount),
      })),
      grand_total: round2(
        billsTotal + budgetAllocationsTotal + ownerDistributionOutflows
      ),
    },
  };

  return output;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
