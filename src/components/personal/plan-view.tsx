"use client";

import { useMemo, useState } from "react";
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
} from "@/lib/types";
import { AlertTriangle, CheckCircle, ArrowDown, ArrowUp } from "lucide-react";

interface PlanItem {
  id: string;
  type: "bill" | "subscription" | "debt";
  name: string;
  amount: number;
  dueDate: string;
  tier: PriorityTier;
  originalTier: PriorityTier;
  overrideId?: string;
}

interface TimelineEntry {
  date: string;
  items: PlanItem[];
  income: ProjectedIncome[];
  balanceAfter: number;
  shortfall: boolean;
}

interface Props {
  accounts: Account[];
  bills: Bill[];
  subscriptions: Subscription[];
  debts: Debt[];
  projectedIncome: ProjectedIncome[];
  planOverrides: PlanOverride[];
  userId: string;
}

export function PlanView({
  accounts,
  bills,
  subscriptions,
  debts,
  projectedIncome,
  planOverrides,
  userId,
}: Props) {
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

  const currentCash = accounts.reduce(
    (sum, a) => sum + Number(a.available_balance ?? a.current_balance),
    0
  );

  // Build plan items with tiers
  const planItems = useMemo(() => {
    const items: PlanItem[] = [];

    // Bills
    for (const bill of bills) {
      const override = localOverrides.get(bill.id);
      items.push({
        id: bill.id,
        type: "bill",
        name: bill.name,
        amount: Number(bill.amount),
        dueDate: bill.due_date,
        tier: override || bill.priority_tier,
        originalTier: bill.priority_tier,
        overrideId: planOverrides.find((o) => o.bill_id === bill.id)?.id,
      });
    }

    // Subscriptions — default to Tier 3 unless overridden
    for (const sub of subscriptions) {
      const override = localOverrides.get(sub.id);
      items.push({
        id: sub.id,
        type: "subscription",
        name: sub.name,
        amount: Number(sub.amount),
        dueDate: sub.next_charge_date,
        tier: override || "3",
        originalTier: "3",
        overrideId: planOverrides.find((o) => o.subscription_id === sub.id)?.id,
      });
    }

    // Debt minimums — default to Tier 2
    for (const debt of debts) {
      const override = localOverrides.get(debt.id);
      items.push({
        id: debt.id,
        type: "debt",
        name: `${debt.creditor} minimum`,
        amount: Number(debt.minimum_payment),
        dueDate: debt.statement_due_date,
        tier: override || "2",
        originalTier: "2",
        overrideId: planOverrides.find((o) => o.debt_id === debt.id)?.id,
      });
    }

    return items;
  }, [bills, subscriptions, debts, localOverrides, planOverrides]);

  // Build timeline: walk day by day for next 30 days
  const timeline = useMemo(() => {
    const entries: TimelineEntry[] = [];
    let runningBalance = currentCash;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i <= 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];

      const dayItems = planItems
        .filter((item) => item.dueDate === dateStr)
        .sort((a, b) => a.tier.localeCompare(b.tier));

      const dayIncome = projectedIncome.filter((inc) => inc.date === dateStr);

      // Add income
      for (const inc of dayIncome) {
        runningBalance += Number(inc.amount);
      }

      // Subtract expenses (tier order)
      for (const item of dayItems) {
        runningBalance -= item.amount;
      }

      if (dayItems.length > 0 || dayIncome.length > 0) {
        entries.push({
          date: dateStr,
          items: dayItems,
          income: dayIncome,
          balanceAfter: runningBalance,
          shortfall: runningBalance < 0,
        });
      }
    }

    return entries;
  }, [planItems, projectedIncome, currentCash]);

  const shortfalls = timeline.filter((e) => e.shortfall);
  const firstShortfall = shortfalls[0];

  // Recommendations: which Tier 3 to cut
  const tier3Items = planItems.filter((i) => i.tier === "3");
  const tier3Total = tier3Items.reduce((sum, i) => i.amount + sum, 0);
  const shortfallAmount = firstShortfall
    ? Math.abs(firstShortfall.balanceAfter)
    : 0;

  const recommendations = useMemo(() => {
    if (!firstShortfall) return [];

    const recs: string[] = [];
    let recovered = 0;

    // Recommend cutting Tier 3 items
    const sorted = [...tier3Items].sort((a, b) => b.amount - a.amount);
    for (const item of sorted) {
      if (recovered >= shortfallAmount) break;
      recs.push(`Cut ${item.name} (${formatCurrency(item.amount)})`);
      recovered += item.amount;
    }

    // If still short, recommend calling Tier 2
    if (recovered < shortfallAmount) {
      const tier2 = planItems
        .filter((i) => i.tier === "2")
        .sort((a, b) => b.amount - a.amount);
      for (const item of tier2) {
        if (recovered >= shortfallAmount) break;
        recs.push(
          `Call ${item.name} and push payment (${formatCurrency(item.amount)})`
        );
        recovered += item.amount;
      }
    }

    return recs;
  }, [firstShortfall, tier3Items, shortfallAmount, planItems]);

  async function overrideTier(itemId: string, itemType: string, newTier: PriorityTier) {
    setLocalOverrides((prev) => {
      const next = new Map(prev);
      next.set(itemId, newTier);
      return next;
    });

    const supabase = createClient();
    const existing = planOverrides.find(
      (o) =>
        o.bill_id === itemId ||
        o.subscription_id === itemId ||
        o.debt_id === itemId
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
      if (itemType === "bill") insert.bill_id = itemId;
      else if (itemType === "subscription") insert.subscription_id = itemId;
      else if (itemType === "debt") insert.debt_id = itemId;

      await supabase.from("plan_overrides").insert(insert);
    }

    router.refresh();
  }

  const totalObligations = planItems.reduce((sum, i) => sum + i.amount, 0);
  const totalIncoming = projectedIncome.reduce(
    (sum, i) => sum + Number(i.amount),
    0
  );
  const endBalance = currentCash + totalIncoming - totalObligations;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">The Plan</h1>
        <p className="text-xs text-muted">Next 30 days</p>
      </div>

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

      {/* Timeline */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Day-by-Day
        </h2>
        <div className="space-y-2">
          {timeline.map((entry) => (
            <Card
              key={entry.date}
              className={`py-3 px-4 ${entry.shortfall ? "border-deficit/30" : ""}`}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted">
                  {formatShortDate(entry.date)}{" "}
                  {daysUntil(entry.date) === 0 && (
                    <span className="text-terracotta">(Today)</span>
                  )}
                </p>
                <p
                  className={`text-sm font-bold ${entry.shortfall ? "text-deficit" : "text-foreground"}`}
                >
                  {formatCurrency(entry.balanceAfter)}
                </p>
              </div>

              {/* Income */}
              {entry.income.map((inc) => (
                <div
                  key={inc.id}
                  className="flex items-center justify-between py-1 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <ArrowDown className="h-3.5 w-3.5 text-surplus" />
                    <span className="text-foreground">{inc.source}</span>
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
                  </div>
                  <span className="text-surplus font-medium">
                    +{formatCurrency(Number(inc.amount))}
                  </span>
                </div>
              ))}

              {/* Expenses */}
              {entry.items.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  className="flex items-center justify-between py-1 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <ArrowUp className="h-3.5 w-3.5 text-deficit" />
                    <span className="text-foreground">{item.name}</span>
                    <button
                      onClick={() => {
                        const tiers: PriorityTier[] = ["1", "2", "3"];
                        const currentIdx = tiers.indexOf(item.tier);
                        const nextTier = tiers[(currentIdx + 1) % 3];
                        overrideTier(item.id, item.type, nextTier);
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
                    {item.tier !== item.originalTier && (
                      <span className="text-[10px] text-terracotta">
                        (overridden)
                      </span>
                    )}
                  </div>
                  <span className="text-foreground font-medium">
                    -{formatCurrency(item.amount)}
                  </span>
                </div>
              ))}
            </Card>
          ))}

          {timeline.length === 0 && (
            <Card className="text-center py-12">
              <p className="text-muted">
                No bills, subscriptions, or income in the next 30 days.
                Add some to see your plan.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
