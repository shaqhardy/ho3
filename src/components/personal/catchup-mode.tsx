"use client";

import { useState, useMemo } from "react";
import { Card, StatCard } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { Debt, Account, ProjectedIncome } from "@/lib/types";
import { TrendingDown, Zap, Snowflake } from "lucide-react";

interface PayoffMonth {
  month: number;
  label: string;
  debts: { id: string; creditor: string; payment: number; remaining: number }[];
  totalPaid: number;
  totalRemaining: number;
}

function simulatePayoff(
  debts: Debt[],
  monthlyExtra: number,
  strategy: "avalanche" | "snowball"
): PayoffMonth[] {
  if (debts.length === 0) return [];

  // Clone debts for simulation
  let remaining = debts.map((d) => ({
    id: d.id,
    creditor: d.creditor,
    balance: Number(d.current_balance),
    apr: Number(d.apr),
    minimum: Number(d.minimum_payment),
  }));

  const months: PayoffMonth[] = [];
  let month = 0;
  const now = new Date();

  while (remaining.some((d) => d.balance > 0) && month < 360) {
    month++;
    const date = new Date(now);
    date.setMonth(date.getMonth() + month);
    const label = date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });

    // Apply interest
    for (const d of remaining) {
      if (d.balance > 0) {
        d.balance += d.balance * (d.apr / 100 / 12);
      }
    }

    // Pay minimums first
    let extraPool = monthlyExtra;
    const monthPayments: PayoffMonth["debts"] = [];

    for (const d of remaining) {
      if (d.balance <= 0) {
        monthPayments.push({
          id: d.id,
          creditor: d.creditor,
          payment: 0,
          remaining: 0,
        });
        continue;
      }
      const payment = Math.min(d.minimum, d.balance);
      d.balance -= payment;
      monthPayments.push({
        id: d.id,
        creditor: d.creditor,
        payment,
        remaining: d.balance,
      });
    }

    // Apply extra to priority debt
    const active = remaining.filter((d) => d.balance > 0);
    if (active.length > 0 && extraPool > 0) {
      // Sort by strategy
      const sorted = [...active].sort((a, b) =>
        strategy === "avalanche" ? b.apr - a.apr : a.balance - b.balance
      );

      for (const target of sorted) {
        if (extraPool <= 0) break;
        const extra = Math.min(extraPool, target.balance);
        target.balance -= extra;
        extraPool -= extra;

        const mp = monthPayments.find((p) => p.id === target.id)!;
        mp.payment += extra;
        mp.remaining = target.balance;
      }
    }

    // When a debt is paid off, its minimum rolls into extra
    for (const d of remaining) {
      if (d.balance <= 0 && d.balance !== -Infinity) {
        d.balance = 0;
      }
    }

    months.push({
      month,
      label,
      debts: monthPayments,
      totalPaid: monthPayments.reduce((s, p) => s + p.payment, 0),
      totalRemaining: remaining.reduce(
        (s, d) => s + Math.max(0, d.balance),
        0
      ),
    });

    if (remaining.every((d) => d.balance <= 0)) break;
  }

  return months;
}

export function CatchupMode({
  debts,
  accounts,
  projectedIncome,
}: {
  debts: Debt[];
  accounts: Account[];
  projectedIncome: ProjectedIncome[];
}) {
  const [strategy, setStrategy] = useState<"avalanche" | "snowball">(
    "avalanche"
  );
  const [extraMonthly, setExtraMonthly] = useState(500);

  const totalCash = accounts.reduce(
    (sum, a) => sum + Number(a.available_balance ?? a.current_balance),
    0
  );
  const totalDebt = debts.reduce(
    (sum, d) => sum + Number(d.current_balance),
    0
  );
  const totalMinimums = debts.reduce(
    (sum, d) => sum + Number(d.minimum_payment),
    0
  );
  const totalProjectedIncome = projectedIncome.reduce(
    (sum, i) => sum + Number(i.amount),
    0
  );

  const avalancheResult = useMemo(
    () => simulatePayoff(debts, extraMonthly, "avalanche"),
    [debts, extraMonthly]
  );
  const snowballResult = useMemo(
    () => simulatePayoff(debts, extraMonthly, "snowball"),
    [debts, extraMonthly]
  );

  const activeResult = strategy === "avalanche" ? avalancheResult : snowballResult;

  const avalancheTotalInterest =
    avalancheResult.reduce((s, m) => s + m.totalPaid, 0) - totalDebt;
  const snowballTotalInterest =
    snowballResult.reduce((s, m) => s + m.totalPaid, 0) - totalDebt;
  const interestSaved = Math.abs(avalancheTotalInterest - snowballTotalInterest);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Catch-Up Mode</h1>
        <p className="text-sm text-muted mt-1">
          Plan your debt payoff when extra money hits.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total Debt"
          value={formatCurrency(totalDebt)}
          color="text-deficit"
        />
        <StatCard
          label="Monthly Minimums"
          value={formatCurrency(totalMinimums)}
        />
        <StatCard
          label="Cash Available"
          value={formatCurrency(totalCash)}
          color="text-surplus"
        />
        <StatCard
          label="Projected Income"
          value={formatCurrency(totalProjectedIncome)}
          subtext="upcoming"
        />
      </div>

      {/* Extra payment slider */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-foreground">
            Extra monthly payment
          </p>
          <p className="text-lg font-bold text-terracotta">
            {formatCurrency(extraMonthly)}
          </p>
        </div>
        <input
          type="range"
          min={0}
          max={3000}
          step={50}
          value={extraMonthly}
          onChange={(e) => setExtraMonthly(Number(e.target.value))}
          className="w-full accent-terracotta"
        />
        <div className="flex justify-between text-xs text-muted mt-1">
          <span>$0</span>
          <span>$3,000</span>
        </div>
      </Card>

      {/* Strategy toggle */}
      <div className="flex gap-3">
        <button
          onClick={() => setStrategy("avalanche")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg border py-3 text-sm font-medium transition-colors ${
            strategy === "avalanche"
              ? "border-terracotta bg-terracotta/10 text-terracotta"
              : "border-border bg-card text-muted hover:text-foreground"
          }`}
        >
          <Zap className="h-4 w-4" />
          Avalanche
          <span className="text-xs opacity-70">(highest APR first)</span>
        </button>
        <button
          onClick={() => setStrategy("snowball")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg border py-3 text-sm font-medium transition-colors ${
            strategy === "snowball"
              ? "border-terracotta bg-terracotta/10 text-terracotta"
              : "border-border bg-card text-muted hover:text-foreground"
          }`}
        >
          <Snowflake className="h-4 w-4" />
          Snowball
          <span className="text-xs opacity-70">(smallest balance first)</span>
        </button>
      </div>

      {/* Comparison */}
      <div className="grid grid-cols-2 gap-3">
        <Card
          className={
            strategy === "avalanche" ? "border-terracotta/30" : ""
          }
        >
          <p className="text-xs text-muted">Avalanche</p>
          <p className="text-lg font-bold text-foreground">
            {avalancheResult.length} months
          </p>
          <p className="text-xs text-deficit">
            {formatCurrency(avalancheTotalInterest)} interest
          </p>
        </Card>
        <Card
          className={
            strategy === "snowball" ? "border-terracotta/30" : ""
          }
        >
          <p className="text-xs text-muted">Snowball</p>
          <p className="text-lg font-bold text-foreground">
            {snowballResult.length} months
          </p>
          <p className="text-xs text-deficit">
            {formatCurrency(snowballTotalInterest)} interest
          </p>
        </Card>
      </div>

      {interestSaved > 10 && (
        <p className="text-xs text-center text-muted">
          Avalanche saves you {formatCurrency(interestSaved)} in interest
        </p>
      )}

      {/* Month-by-month plan */}
      {debts.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Month-by-Month Plan ({strategy})
          </h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {activeResult.slice(0, 36).map((month) => (
              <Card key={month.month} className="py-3 px-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted">
                    {month.label}
                  </p>
                  <p className="text-sm font-bold text-foreground">
                    {formatCurrency(month.totalRemaining)} left
                  </p>
                </div>
                {month.debts
                  .filter((d) => d.payment > 0)
                  .map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between text-xs py-0.5"
                    >
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-3 w-3 text-surplus" />
                        <span className="text-foreground">{d.creditor}</span>
                      </div>
                      <div className="flex gap-3 text-muted">
                        <span>Pay {formatCurrency(d.payment)}</span>
                        <span
                          className={
                            d.remaining <= 0 ? "text-surplus font-medium" : ""
                          }
                        >
                          {d.remaining <= 0
                            ? "PAID OFF!"
                            : formatCurrency(d.remaining)}
                        </span>
                      </div>
                    </div>
                  ))}
              </Card>
            ))}
          </div>
        </div>
      )}

      {debts.length === 0 && (
        <Card className="text-center py-12">
          <p className="text-surplus font-medium">Debt free! Nothing to catch up on.</p>
        </Card>
      )}
    </div>
  );
}
