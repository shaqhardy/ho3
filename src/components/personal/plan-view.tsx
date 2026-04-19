"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, StatCard } from "@/components/ui/card";
import { formatCurrency, formatShortDate, daysUntil } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type {
  Account,
  Bill,
  Subscription,
  Debt,
  ProjectedIncome,
  PlanOverride,
  PriorityTier,
  IncomeEntry,
} from "@/lib/types";
import {
  computeProjection,
  type ProjectionItem,
  type Scenario,
} from "@/lib/projection/engine";
import { WhatIfBadge, WhatIfPanel } from "@/components/whatif-view";
import {
  AlertTriangle,
  CheckCircle,
  ArrowDown,
  ArrowUp,
  PlusCircle,
} from "lucide-react";
import type { BudgetPlanContext } from "@/lib/budgets/plan-integration";
import { CashflowProjectionChart } from "@/components/charts/cashflow-projection";
import { AddIncomeDialog } from "@/components/income/add-income-dialog";

interface Props {
  accounts: Account[];
  bills: Bill[];
  subscriptions: Subscription[];
  debts: Debt[];
  projectedIncome: ProjectedIncome[];
  planOverrides: PlanOverride[];
  userId: string;
  scenarios?: Scenario[];
  budgetContext?: BudgetPlanContext;
  incomeEntries?: IncomeEntry[];
}

const STORAGE_KEY = "ho3-plan-include-whatif";

export function PlanView({
  accounts,
  bills,
  subscriptions,
  debts,
  projectedIncome,
  planOverrides,
  userId,
  scenarios: initialScenarios,
  budgetContext,
  incomeEntries = [],
}: Props) {
  // Map projected_income.id → { total, count } of logged actual income.
  const actualByPlanId = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const e of incomeEntries) {
      if (!e.linked_plan_item_id) continue;
      const prev = m.get(e.linked_plan_item_id) ?? { total: 0, count: 0 };
      prev.total += Number(e.amount);
      prev.count += 1;
      m.set(e.linked_plan_item_id, prev);
    }
    return m;
  }, [incomeEntries]);

  // Accounts for the Log Actual dialog — personal only (Plan is personal).
  const incomeDialogAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.book === "personal")
        .map((a) => ({
          id: a.id,
          name: a.name,
          mask: a.mask,
          book: a.book,
        })),
    [accounts]
  );

  const [logActualFor, setLogActualFor] = useState<{
    planItemId: string;
    amount: number;
    source: string | null;
  } | null>(null);
  const router = useRouter();
  const [localOverrides, setLocalOverrides] = useState<
    Map<string, PriorityTier>
  >(() => {
    const map = new Map<string, PriorityTier>();
    for (const o of planOverrides) {
      const key = o.bill_id || o.subscription_id || o.debt_id || "";
      map.set(key, o.override_tier);
    }
    return map;
  });

  // --- What If toggle (persisted in localStorage) ---
  // Read initial toggle lazily from localStorage so we don't cause a cascading
  // render when the effect mirrors state back in.
  const [includeWhatIf, setIncludeWhatIf] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [fetchedScenarios, setFetchedScenarios] = useState<Scenario[] | null>(
    null
  );
  const scenarios = useMemo<Scenario[]>(
    () => initialScenarios ?? fetchedScenarios ?? [],
    [initialScenarios, fetchedScenarios]
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, includeWhatIf ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [includeWhatIf]);

  // Fetch scenarios on demand when toggle flips on (if not provided by page)
  useEffect(() => {
    if (initialScenarios) return;
    if (!includeWhatIf) return;
    if (fetchedScenarios !== null) return;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/scenarios?book=personal", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { scenarios?: Scenario[] };
        if (!aborted) {
          setFetchedScenarios(json.scenarios ?? []);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      aborted = true;
    };
  }, [includeWhatIf, fetchedScenarios, initialScenarios]);

  // Projection starts from spendable cash only. Credit/loan accounts never
  // contribute to cash-on-hand — the plan/page query already filters to
  // depository, but we defend here in case a consumer ever passes mixed data.
  const currentCash = accounts
    .filter((a) => a.type === "depository")
    .reduce(
      (sum, a) => sum + Number(a.available_balance ?? a.current_balance ?? 0),
      0
    );

  // Project via engine — with or without scenarios
  const projection = useMemo(
    () =>
      computeProjection({
        currentCash,
        bills,
        subscriptions,
        debts,
        projectedIncome,
        scenarios: includeWhatIf ? scenarios : [],
        priorityOverrides: localOverrides,
        daysAhead: 30,
      }),
    [
      currentCash,
      bills,
      subscriptions,
      debts,
      projectedIncome,
      includeWhatIf,
      scenarios,
      localOverrides,
    ]
  );

  const firstShortfall = projection.firstShortfall;
  const endBalance = projection.endBalance;

  // Derive obligations, income, tier3Items, recommendations from the single
  // `projection` source — one memo prevents cascading recomputation and keeps
  // stable references for dependent hooks.
  const derived = useMemo(() => {
    let totalObligations = 0;
    let totalIncoming = 0;
    const tier3Items: ProjectionItem[] = [];
    const tier2Items: ProjectionItem[] = [];

    for (const item of projection.items) {
      if (item.isIncome) {
        totalIncoming += item.amount;
      } else {
        totalObligations += item.amount;
        if (item.tier === "3") tier3Items.push(item);
        else if (item.tier === "2") tier2Items.push(item);
      }
    }

    const tier3Total = tier3Items.reduce((sum, i) => sum + i.amount, 0);
    const shortfallAmount = projection.firstShortfall
      ? Math.abs(projection.firstShortfall.balanceAfter)
      : 0;

    const recommendations: string[] = [];
    if (projection.firstShortfall) {
      let recovered = 0;
      const sorted = tier3Items.toSorted((a, b) => b.amount - a.amount);
      for (const item of sorted) {
        if (recovered >= shortfallAmount) break;
        recommendations.push(
          `Cut ${item.name} (${formatCurrency(item.amount)})`
        );
        recovered += item.amount;
      }
      if (recovered < shortfallAmount) {
        const tier2Sorted = tier2Items.toSorted(
          (a, b) => b.amount - a.amount
        );
        for (const item of tier2Sorted) {
          if (recovered >= shortfallAmount) break;
          recommendations.push(
            `Call ${item.name} and push payment (${formatCurrency(item.amount)})`
          );
          recovered += item.amount;
        }
      }
    }

    return {
      totalObligations,
      totalIncoming,
      tier3Total,
      recommendations,
    };
  }, [projection]);

  const {
    totalObligations,
    totalIncoming,
    tier3Total,
    recommendations,
  } = derived;

  async function overrideTier(
    sourceId: string,
    itemType: ProjectionItem["type"],
    newTier: PriorityTier
  ) {
    setLocalOverrides((prev) => {
      const next = new Map(prev);
      next.set(sourceId, newTier);
      return next;
    });

    const supabase = createClient();
    const existing = planOverrides.find(
      (o) =>
        o.bill_id === sourceId ||
        o.subscription_id === sourceId ||
        o.debt_id === sourceId
    );

    if (existing) {
      await supabase
        .from("plan_overrides")
        .update({ override_tier: newTier })
        .eq("id", existing.id);
    } else {
      const insert: Record<string, unknown> = {
        user_id: userId,
        override_tier: newTier,
      };
      if (itemType === "bill") insert.bill_id = sourceId;
      else if (itemType === "subscription") insert.subscription_id = sourceId;
      else if (itemType === "debt") insert.debt_id = sourceId;

      await supabase.from("plan_overrides").insert(insert);
    }

    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">The Plan</h1>
        <p className="text-xs text-muted">Next 30 days</p>
      </div>

      {/* Budget overages from active budgets — surfaced so the Plan view can
          deprioritize discretionary spend in categories that are already
          blown through. */}
      {budgetContext &&
        (budgetContext.overLimitCategories.length > 0 ||
          budgetContext.nearLimitCategories.length > 0) && (
          <Card accent="warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
              <div className="flex-1 text-sm">
                <p className="font-medium">Budget alerts this period</p>
                {budgetContext.overLimitCategories.length > 0 && (
                  <p className="mt-1 text-xs">
                    <span className="text-deficit font-medium">
                      Over budget:
                    </span>{" "}
                    {budgetContext.overLimitCategories
                      .map(
                        (c) =>
                          `${c.name} ${Math.round(c.percent)}% ($${c.overage.toFixed(0)} over)`
                      )
                      .join(" · ")}
                  </p>
                )}
                {budgetContext.nearLimitCategories.length > 0 && (
                  <p className="mt-1 text-xs">
                    <span className="text-warning font-medium">
                      Near limit:
                    </span>{" "}
                    {budgetContext.nearLimitCategories
                      .map((c) => `${c.name} ${Math.round(c.percent)}%`)
                      .join(" · ")}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-muted">
                  Discretionary spend in these categories is deprioritized.
                </p>
              </div>
            </div>
          </Card>
        )}

      {/* What If toggle */}
      <WhatIfPanel
        book="personal"
        currentCash={currentCash}
        bills={bills}
        subscriptions={subscriptions}
        debts={debts}
        projectedIncome={projectedIncome}
        scenarios={initialScenarios ?? scenarios}
        include={includeWhatIf}
        onIncludeChange={setIncludeWhatIf}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Cash Now" value={formatCurrency(currentCash)} />
        <StatCard
          label="Expected Income"
          value={formatCurrency(totalIncoming)}
          color="text-surplus"
        />
        <StatCard
          label="Total Obligations"
          value={formatCurrency(totalObligations)}
          color="text-deficit"
        />
        <StatCard
          label="End of Period"
          value={formatCurrency(endBalance)}
          color={endBalance >= 0 ? "text-surplus" : "text-deficit"}
        />
      </div>

      {/* Shortfall warning */}
      {firstShortfall && (
        <Card className="border-deficit/30 bg-deficit/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-deficit mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-deficit">
                Shortfall on {formatShortDate(firstShortfall.date)}
              </p>
              <p className="text-sm text-muted mt-1">
                You&apos;ll be{" "}
                <span className="font-semibold text-deficit">
                  {formatCurrency(Math.abs(firstShortfall.balanceAfter))}
                </span>{" "}
                short. Here&apos;s what I recommend:
              </p>
              <ul className="mt-2 space-y-1">
                {recommendations.map((rec, i) => (
                  <li key={i} className="text-sm text-foreground flex gap-2">
                    <span className="text-terracotta">&bull;</span>
                    {rec}
                  </li>
                ))}
              </ul>
              {tier3Total > 0 && (
                <p className="text-xs text-muted mt-2">
                  Cutting all Tier 3 items saves{" "}
                  {formatCurrency(tier3Total)}/month
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {!firstShortfall && (
        <Card className="border-surplus/30 bg-surplus/5">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-surplus" />
            <p className="text-sm font-medium text-surplus">
              You&apos;re covered for the next 30 days. End balance:{" "}
              {formatCurrency(endBalance)}
            </p>
          </div>
        </Card>
      )}

      {/* Projected cash line — 30 day forward look */}
      {projection.timeline.length > 0 && (
        <Card>
          <CashflowProjectionChart
            points={projection.timeline.map((e) => ({
              date: e.date,
              label: formatShortDate(e.date),
              balance: e.balanceAfter,
              net: (e.income.reduce((s, i) => s + i.amount, 0) -
                e.expenses.reduce((s, i) => s + i.amount, 0)),
            }))}
          />
        </Card>
      )}

      {/* Timeline */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Day-by-Day
        </h2>
        <div className="space-y-2">
          {projection.timeline.map((entry) => (
            <Card
              key={entry.date}
              className={`py-3 px-4 ${
                entry.shortfall ? "border-deficit/30" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted">
                  {formatShortDate(entry.date)}{" "}
                  {daysUntil(entry.date) === 0 && (
                    <span className="text-terracotta">(Today)</span>
                  )}
                </p>
                <p
                  className={`text-sm font-bold ${
                    entry.shortfall ? "text-deficit" : "text-foreground"
                  }`}
                >
                  {formatCurrency(entry.balanceAfter)}
                </p>
              </div>

              {/* Income */}
              {entry.income.map((inc) => {
                const canLogActual =
                  !inc.isHypothetical && inc.type === "income";
                const actual = canLogActual
                  ? actualByPlanId.get(inc.sourceId)
                  : undefined;
                const variance = actual
                  ? actual.total - inc.amount
                  : 0;
                return (
                <div
                  key={inc.id}
                  className="flex items-center justify-between py-1 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ArrowDown className="h-3.5 w-3.5 text-surplus shrink-0" />
                    <span
                      className={`truncate ${
                        inc.isHypothetical
                          ? "italic text-foreground"
                          : "text-foreground"
                      }`}
                    >
                      {inc.name}
                    </span>
                    {inc.isHypothetical && <WhatIfBadge />}
                    {inc.confidence && (
                      <span
                        className={`text-[10px] px-1 rounded ${
                          inc.confidence === "confirmed"
                            ? "bg-surplus/10 text-surplus"
                            : inc.confidence === "expected"
                              ? "bg-warning/10 text-warning"
                              : "bg-card-hover text-muted"
                        }`}
                      >
                        {inc.confidence}
                      </span>
                    )}
                    {actual && (
                      <span
                        className={`text-[10px] px-1 rounded ${
                          variance >= 0
                            ? "bg-surplus/10 text-surplus"
                            : "bg-deficit/10 text-deficit"
                        }`}
                        title={`Logged ${formatCurrency(actual.total)} of expected ${formatCurrency(inc.amount)}`}
                      >
                        Actual {formatCurrency(actual.total)}{" "}
                        {variance >= 0 ? "↑" : "↓"}
                        {formatCurrency(Math.abs(variance))}
                      </span>
                    )}
                    {canLogActual && !actual && (
                      <button
                        type="button"
                        onClick={() =>
                          setLogActualFor({
                            planItemId: inc.sourceId,
                            amount: inc.amount,
                            source: inc.name,
                          })
                        }
                        className="inline-flex items-center gap-0.5 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium text-muted hover:border-terracotta hover:text-terracotta"
                      >
                        <PlusCircle className="h-2.5 w-2.5" /> Log Actual
                      </button>
                    )}
                  </div>
                  <span className="text-surplus font-medium shrink-0">
                    +{formatCurrency(inc.amount)}
                  </span>
                </div>
                );
              })}

              {/* Expenses */}
              {entry.expenses.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-1 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ArrowUp className="h-3.5 w-3.5 text-deficit shrink-0" />
                    <span
                      className={`truncate ${
                        item.isHypothetical
                          ? "italic text-foreground"
                          : "text-foreground"
                      }`}
                    >
                      {item.name}
                    </span>
                    {item.isHypothetical && <WhatIfBadge />}
                    {!item.isHypothetical && (
                      <button
                        onClick={() => {
                          const tiers: PriorityTier[] = ["1", "2", "3"];
                          const currentIdx = tiers.indexOf(item.tier);
                          const nextTier = tiers[(currentIdx + 1) % 3];
                          overrideTier(item.sourceId, item.type, nextTier);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium cursor-pointer ${
                          item.tier === "1"
                            ? "bg-deficit/10 text-deficit"
                            : item.tier === "2"
                              ? "bg-warning/10 text-warning"
                              : "bg-card-hover text-muted"
                        }`}
                        title="Click to change priority tier"
                      >
                        T{item.tier}
                      </button>
                    )}
                    {!item.isHypothetical &&
                      item.tier !== item.originalTier && (
                        <span className="text-[10px] text-terracotta">
                          (overridden)
                        </span>
                      )}
                  </div>
                  <span className="text-foreground font-medium shrink-0">
                    -{formatCurrency(item.amount)}
                  </span>
                </div>
              ))}
            </Card>
          ))}

          {projection.timeline.length === 0 && (
            <Card className="text-center py-12">
              <p className="text-muted">
                No bills, subscriptions, or income in the next 30 days. Add some
                to see your plan.
              </p>
            </Card>
          )}
        </div>
      </div>

      <AddIncomeDialog
        open={logActualFor !== null}
        onClose={() => setLogActualFor(null)}
        accounts={incomeDialogAccounts}
        availableBooks={["personal"]}
        defaults={
          logActualFor
            ? {
                book: "personal",
                amount: logActualFor.amount,
                source: logActualFor.source,
                linkedPlanItemId: logActualFor.planItemId,
              }
            : undefined
        }
      />
    </div>
  );
}
