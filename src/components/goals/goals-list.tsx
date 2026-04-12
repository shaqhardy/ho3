"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, ElevatedCard } from "@/components/ui/card";
import { GoalProgress } from "@/components/goals/goal-progress";
import { formatCurrency, formatDate, daysUntil } from "@/lib/format";
import { computeGoalProgress, type GoalLike } from "@/lib/goals/compute";
import type { Account, Debt } from "@/lib/types";
import { Plus, Target, TrendingUp, CreditCard, Wallet, ChevronRight } from "lucide-react";

type GoalType = "savings" | "debt_payoff" | "income" | "custom";

interface GoalRow extends GoalLike {
  note: string | null;
  progress?: {
    current: number;
    target: number;
    percent: number;
    remaining: number;
    dailyPaceNeeded: number | null;
    projectedCompletion: Date | null;
    onTrack: boolean | null;
    isCompleted: boolean;
  };
}

interface Props {
  goals: GoalRow[];
  accounts: Account[];
  debts: Debt[];
  book?: string;
}

const typeConfig: Record<
  GoalType,
  { label: string; icon: typeof Target; color: string }
> = {
  savings: { label: "Savings", icon: Wallet, color: "text-surplus" },
  debt_payoff: { label: "Debt Payoff", icon: CreditCard, color: "text-deficit" },
  income: { label: "Income", icon: TrendingUp, color: "text-terracotta" },
  custom: { label: "Custom", icon: Target, color: "text-muted" },
};

export function GoalsList({ goals, accounts, debts, book = "personal" }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<GoalType>("savings");
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [linkedDebtId, setLinkedDebtId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const active = goals.filter((g) => g.status === "active");
  const completed = goals.filter((g) => g.status === "completed");
  const paused = goals.filter((g) => g.status === "paused");

  const depositoryAccounts = accounts.filter((a) => a.type === "depository");

  async function createGoal() {
    if (!name || !targetAmount) return;
    setSubmitting(true);
    const body: Record<string, unknown> = {
      book,
      name,
      type,
      target_amount: Number(targetAmount),
      note: note || null,
    };
    if (targetDate) body.target_date = targetDate;
    if (type === "savings" && linkedAccountId) body.linked_account_id = linkedAccountId;
    if (type === "debt_payoff" && linkedDebtId) body.linked_debt_id = linkedDebtId;

    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setAdding(false);
      setName("");
      setTargetAmount("");
      setTargetDate("");
      setLinkedAccountId("");
      setLinkedDebtId("");
      setNote("");
      setType("savings");
      router.refresh();
    } else {
      const d = await res.json();
      alert(`Failed: ${d.error}`);
    }
    setSubmitting(false);
  }

  function renderGoalCard(g: GoalRow) {
    const cfg = typeConfig[g.type];
    const Icon = cfg.icon;
    const p = g.progress || computeGoalProgress(g);
    const targetDaysLeft = g.target_date ? daysUntil(g.target_date) : null;

    return (
      <Link key={g.id} href={`/personal/goals/${g.id}`}>
        <Card
          interactive
          accent={
            g.status === "completed"
              ? "surplus"
              : p.onTrack === false
                ? "warning"
                : "terracotta"
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-${cfg.color.replace("text-", "")}/10`}>
                <Icon className={`h-5 w-5 ${cfg.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">
                  {g.name}
                </p>
                <p className="text-xs text-muted">{cfg.label}</p>
                <div className="mt-3">
                  <GoalProgress
                    current={p.current}
                    target={p.target}
                    percent={p.percent}
                    onTrack={p.onTrack}
                  />
                </div>
                {targetDaysLeft !== null && g.status === "active" && (
                  <p className="mt-2 text-xs text-muted">
                    {targetDaysLeft < 0
                      ? `${Math.abs(targetDaysLeft)}d past target`
                      : targetDaysLeft === 0
                        ? "Due today"
                        : `${targetDaysLeft}d until target`}
                    {p.onTrack === false && (
                      <span className="ml-2 text-warning">• behind pace</span>
                    )}
                    {p.onTrack === true && (
                      <span className="ml-2 text-surplus">• on track</span>
                    )}
                  </p>
                )}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted mt-1" />
          </div>
        </Card>
      </Link>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-hover"
        >
          <Plus className="h-4 w-4" />
          New goal
        </button>
      </div>

      {adding && (
        <ElevatedCard accent="terracotta">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Create new goal
          </h3>
          <div className="space-y-3">
            <div>
              <p className="label-sm mb-2">Type</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["savings", "debt_payoff", "income", "custom"] as const).map(
                  (t) => {
                    const cfg = typeConfig[t];
                    const Icon = cfg.icon;
                    return (
                      <button
                        key={t}
                        onClick={() => setType(t)}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors ${
                          type === t
                            ? "border-terracotta bg-terracotta/10 text-terracotta"
                            : "border-border text-muted hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {cfg.label}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            <input
              placeholder="Goal name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                step="0.01"
                placeholder="Target amount"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                placeholder="Target date (optional)"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
              />
            </div>

            {type === "savings" && depositoryAccounts.length > 0 && (
              <div>
                <p className="label-sm mb-1">Link to account (optional)</p>
                <select
                  value={linkedAccountId}
                  onChange={(e) => setLinkedAccountId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                >
                  <option value="">— none —</option>
                  {depositoryAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatCurrency(Number(a.current_balance))})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">
                  Progress tracks this account&apos;s balance automatically.
                </p>
              </div>
            )}

            {type === "debt_payoff" && debts.length > 0 && (
              <div>
                <p className="label-sm mb-1">Link to debt</p>
                <select
                  value={linkedDebtId}
                  onChange={(e) => setLinkedDebtId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                >
                  <option value="">— none —</option>
                  {debts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.creditor} ({formatCurrency(Number(d.current_balance))})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">
                  Progress auto-tracks as this debt shrinks.
                </p>
              </div>
            )}

            <input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setAdding(false)}
                className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={createGoal}
                disabled={submitting || !name || !targetAmount}
                className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-hover disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save goal"}
              </button>
            </div>
          </div>
        </ElevatedCard>
      )}

      {goals.length === 0 && !adding && (
        <Card className="text-center py-12">
          <Target className="mx-auto h-8 w-8 text-muted mb-3" />
          <p className="text-muted">
            No goals yet. Click &ldquo;New goal&rdquo; to start tracking one.
          </p>
        </Card>
      )}

      {active.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="label-sm">Active</h2>
          </div>
          <div className="space-y-2">{active.map(renderGoalCard)}</div>
        </section>
      )}

      {paused.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="label-sm">Paused</h2>
          </div>
          <div className="space-y-2 opacity-60">
            {paused.map(renderGoalCard)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="label-sm">Completed</h2>
          </div>
          <div className="space-y-2">{completed.map(renderGoalCard)}</div>
        </section>
      )}
    </div>
  );
}
