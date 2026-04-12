/**
 * Shared surplus/deficit projection engine.
 * Pure function — given current state + scenarios, returns a day-by-day timeline.
 */

import type {
  Bill,
  Subscription,
  Debt,
  ProjectedIncome,
  PriorityTier,
  ConfidenceLevel,
} from "@/lib/types";

export interface Scenario {
  id: string;
  book: "personal" | "business" | "nonprofit" | "cross-book";
  type: "expense" | "income";
  name: string;
  amount: number;
  date: string;
  source: string | null;
  confidence: ConfidenceLevel | null;
  override_full_amount: boolean;
  is_active: boolean;
  account_id: string | null;
  category_id: string | null;
  note: string | null;
}

export interface ProjectionItem {
  id: string;
  sourceId: string; // original entity id for overrides
  type: "bill" | "subscription" | "debt" | "scenario_expense" | "scenario_income" | "income";
  name: string;
  amount: number;
  dueDate: string;
  tier: PriorityTier;
  originalTier: PriorityTier;
  isHypothetical: boolean;
  isIncome: boolean;
  confidence?: ConfidenceLevel | null;
  appliedMultiplier?: number;
}

export interface TimelineEntry {
  date: string;
  expenses: ProjectionItem[];
  income: ProjectionItem[];
  balanceAfter: number;
  shortfall: boolean;
}

export interface ProjectionInput {
  currentCash: number;
  bills: Bill[];
  subscriptions: Subscription[];
  debts: Debt[];
  projectedIncome: ProjectedIncome[];
  scenarios?: Scenario[];
  priorityOverrides?: Map<string, PriorityTier>;
  daysAhead?: number;
  respectConfidence?: boolean; // weight income by confidence level, default true
}

export interface ProjectionOutput {
  startCash: number;
  timeline: TimelineEntry[];
  firstShortfall: TimelineEntry | null;
  shortfalls: TimelineEntry[];
  totalExpenses: number;
  totalIncome: number;
  endBalance: number;
  items: ProjectionItem[];
}

export function confidenceMultiplier(
  confidence: ConfidenceLevel | null | undefined,
  overrideFullAmount: boolean
): number {
  if (overrideFullAmount) return 1;
  if (!confidence || confidence === "confirmed") return 1;
  if (confidence === "expected") return 0.75;
  if (confidence === "tentative") return 0.5;
  return 1;
}

export function computeProjection(input: ProjectionInput): ProjectionOutput {
  const {
    currentCash,
    bills,
    subscriptions,
    debts,
    projectedIncome,
    scenarios = [],
    priorityOverrides,
    daysAhead = 30,
    respectConfidence = true,
  } = input;

  const items: ProjectionItem[] = [];

  // Bills
  for (const bill of bills) {
    const override = priorityOverrides?.get(bill.id);
    items.push({
      id: `bill_${bill.id}`,
      sourceId: bill.id,
      type: "bill",
      name: bill.name,
      amount: Number(bill.amount),
      dueDate: bill.due_date,
      tier: override ?? bill.priority_tier,
      originalTier: bill.priority_tier,
      isHypothetical: false,
      isIncome: false,
    });
  }

  // Subscriptions — default Tier 3
  for (const sub of subscriptions) {
    const override = priorityOverrides?.get(sub.id);
    items.push({
      id: `sub_${sub.id}`,
      sourceId: sub.id,
      type: "subscription",
      name: sub.name,
      amount: Number(sub.amount),
      dueDate: sub.next_charge_date,
      tier: override ?? "3",
      originalTier: "3",
      isHypothetical: false,
      isIncome: false,
    });
  }

  // Debt minimums — default Tier 2
  for (const debt of debts) {
    const override = priorityOverrides?.get(debt.id);
    items.push({
      id: `debt_${debt.id}`,
      sourceId: debt.id,
      type: "debt",
      name: `${debt.creditor} minimum`,
      amount: Number(debt.minimum_payment),
      dueDate: debt.statement_due_date,
      tier: override ?? "2",
      originalTier: "2",
      isHypothetical: false,
      isIncome: false,
    });
  }

  // Projected real income
  for (const inc of projectedIncome) {
    const multiplier = respectConfidence
      ? confidenceMultiplier(inc.confidence, false)
      : 1;
    const amt = Number(inc.amount) * multiplier;
    if (amt > 0) {
      items.push({
        id: `inc_${inc.id}`,
        sourceId: inc.id,
        type: "income",
        name: inc.source,
        amount: amt,
        dueDate: inc.date,
        tier: "1",
        originalTier: "1",
        isHypothetical: false,
        isIncome: true,
        confidence: inc.confidence,
        appliedMultiplier: multiplier,
      });
    }
  }

  // Active scenarios (hypothetical)
  for (const sc of scenarios) {
    if (!sc.is_active) continue;

    if (sc.type === "income") {
      const multiplier = respectConfidence
        ? confidenceMultiplier(sc.confidence, sc.override_full_amount)
        : 1;
      const amt = Number(sc.amount) * multiplier;
      if (amt > 0) {
        items.push({
          id: `sc_${sc.id}`,
          sourceId: sc.id,
          type: "scenario_income",
          name: sc.source || sc.name,
          amount: amt,
          dueDate: sc.date,
          tier: "1",
          originalTier: "1",
          isHypothetical: true,
          isIncome: true,
          confidence: sc.confidence,
          appliedMultiplier: multiplier,
        });
      }
    } else {
      // Expense scenarios — treat like Tier 3 by default (discretionary)
      const multiplier = respectConfidence
        ? confidenceMultiplier(sc.confidence, sc.override_full_amount)
        : 1;
      const amt = Number(sc.amount) * multiplier;
      items.push({
        id: `sc_${sc.id}`,
        sourceId: sc.id,
        type: "scenario_expense",
        name: sc.name,
        amount: amt,
        dueDate: sc.date,
        tier: "3",
        originalTier: "3",
        isHypothetical: true,
        isIncome: false,
        confidence: sc.confidence,
        appliedMultiplier: multiplier,
      });
    }
  }

  // Walk timeline
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const timeline: TimelineEntry[] = [];
  let runningBalance = currentCash;

  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];

    const todaysIncome = items
      .filter((it) => it.isIncome && it.dueDate === dateStr)
      .sort((a, b) => a.name.localeCompare(b.name));

    const todaysExpenses = items
      .filter((it) => !it.isIncome && it.dueDate === dateStr)
      .sort((a, b) => a.tier.localeCompare(b.tier));

    for (const inc of todaysIncome) runningBalance += inc.amount;
    for (const exp of todaysExpenses) runningBalance -= exp.amount;

    if (todaysIncome.length > 0 || todaysExpenses.length > 0) {
      timeline.push({
        date: dateStr,
        expenses: todaysExpenses,
        income: todaysIncome,
        balanceAfter: runningBalance,
        shortfall: runningBalance < 0,
      });
    }
  }

  const shortfalls = timeline.filter((e) => e.shortfall);
  const totalIncome = items
    .filter((i) => i.isIncome)
    .reduce((sum, i) => sum + i.amount, 0);
  const totalExpenses = items
    .filter((i) => !i.isIncome)
    .reduce((sum, i) => sum + i.amount, 0);

  return {
    startCash: currentCash,
    timeline,
    firstShortfall: shortfalls[0] ?? null,
    shortfalls,
    totalExpenses,
    totalIncome,
    endBalance: currentCash + totalIncome - totalExpenses,
    items,
  };
}

/**
 * Compare two projections — returns the delta caused by scenarios.
 * Useful for "Current vs With scenarios" side-by-side.
 */
export function compareProjections(
  base: ProjectionOutput,
  withScenarios: ProjectionOutput
) {
  const baseShortfallDates = new Set(base.shortfalls.map((e) => e.date));
  const scenShortfallDates = new Set(
    withScenarios.shortfalls.map((e) => e.date)
  );

  const newShortfalls = withScenarios.shortfalls.filter(
    (e) => !baseShortfallDates.has(e.date)
  );
  const erasedShortfalls = base.shortfalls.filter(
    (e) => !scenShortfallDates.has(e.date)
  );

  return {
    endBalanceDelta: withScenarios.endBalance - base.endBalance,
    newShortfalls,
    erasedShortfalls,
    baseEndBalance: base.endBalance,
    scenarioEndBalance: withScenarios.endBalance,
  };
}
