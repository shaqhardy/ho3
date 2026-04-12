"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, ElevatedCard } from "@/components/ui/card";
import { GoalProgress } from "@/components/goals/goal-progress";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  computeGoalProgress,
  type GoalLike,
  type LinkedAccount,
  type LinkedDebt,
  type ContributionLike,
} from "@/lib/goals/compute";
import { ArrowLeft, Plus, Trash2, Pause, Play, Pencil, Check, X } from "lucide-react";

interface Contribution extends ContributionLike {
  id: string;
  source: string;
  note: string | null;
}

interface Props {
  goal: GoalLike & { note: string | null };
  contributions: Contribution[];
  linkedAccount?: LinkedAccount | null;
  linkedDebt?: LinkedDebt | null;
  linkedAccountName?: string | null;
  linkedDebtName?: string | null;
}

export function GoalDetail({
  goal,
  contributions,
  linkedAccount,
  linkedDebt,
  linkedAccountName,
  linkedDebtName,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(goal.name);
  const [targetAmount, setTargetAmount] = useState(String(goal.target_amount));
  const [targetDate, setTargetDate] = useState(goal.target_date || "");
  const [addingContrib, setAddingContrib] = useState(false);
  const [contribAmount, setContribAmount] = useState("");
  const [contribDate, setContribDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [contribNote, setContribNote] = useState("");

  const progress = computeGoalProgress(
    goal,
    linkedAccount,
    linkedDebt,
    contributions
  );

  const isLinked = !!(linkedAccount || linkedDebt);

  async function saveEdit() {
    await fetch(`/api/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        target_amount: Number(targetAmount),
        target_date: targetDate || null,
      }),
    });
    setEditing(false);
    router.refresh();
  }

  async function togglePause() {
    const newStatus = goal.status === "paused" ? "active" : "paused";
    await fetch(`/api/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    router.refresh();
  }

  async function deleteGoal() {
    if (!confirm(`Delete goal "${goal.name}"?`)) return;
    await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
    router.push("/personal/goals");
    router.refresh();
  }

  async function addContribution() {
    if (!contribAmount) return;
    await fetch(`/api/goals/${goal.id}/contributions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(contribAmount),
        date: contribDate,
        note: contribNote || null,
      }),
    });
    setAddingContrib(false);
    setContribAmount("");
    setContribNote("");
    router.refresh();
  }

  async function deleteContribution(contribId: string) {
    if (!confirm("Delete this contribution?")) return;
    await fetch(`/api/goals/${goal.id}/contributions/${contribId}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/personal/goals"
          className="flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={togglePause}
            className="text-xs text-muted hover:text-foreground"
          >
            {goal.status === "paused" ? (
              <>
                <Play className="inline h-3.5 w-3.5" /> Resume
              </>
            ) : (
              <>
                <Pause className="inline h-3.5 w-3.5" /> Pause
              </>
            )}
          </button>
          <button
            onClick={deleteGoal}
            className="text-xs text-muted hover:text-deficit"
          >
            <Trash2 className="inline h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      <header>
        <p className="label-sm">Goal</p>
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xl font-bold text-foreground focus:border-terracotta focus:outline-none"
          />
        ) : (
          <h1 className="mt-1 text-2xl font-bold text-foreground">
            {goal.name}
            <button
              onClick={() => setEditing(true)}
              className="ml-3 text-muted hover:text-terracotta"
            >
              <Pencil className="inline h-4 w-4" />
            </button>
          </h1>
        )}
        {goal.status === "completed" && (
          <p className="mt-1 text-xs text-surplus font-medium">
            ✓ Completed
          </p>
        )}
      </header>

      {/* Hero progress */}
      <ElevatedCard accent={progress.isCompleted ? "surplus" : "terracotta"}>
        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="label-sm">Current</p>
            <p className="mt-2 hero-value text-foreground">
              {formatCurrency(progress.current)}
            </p>
          </div>
          <div className="text-right">
            <p className="label-sm">Target</p>
            {editing ? (
              <input
                type="number"
                step="0.01"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                className="mt-2 w-32 text-right rounded-lg border border-border bg-background px-2 py-1 text-lg font-bold text-foreground focus:border-terracotta focus:outline-none"
              />
            ) : (
              <p className="mt-2 display-value text-muted">
                {formatCurrency(progress.target)}
              </p>
            )}
          </div>
        </div>
        <GoalProgress
          current={progress.current}
          target={progress.target}
          percent={progress.percent}
          size="lg"
          onTrack={progress.onTrack}
        />
      </ElevatedCard>

      {editing && (
        <Card>
          <div className="space-y-3">
            <div>
              <p className="label-sm mb-1">Target date</p>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setName(goal.name);
                  setTargetAmount(String(goal.target_amount));
                  setTargetDate(goal.target_date || "");
                }}
                className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
              >
                <X className="inline h-3.5 w-3.5" /> Cancel
              </button>
              <button
                onClick={saveEdit}
                className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-hover"
              >
                <Check className="inline h-3.5 w-3.5" /> Save
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <p className="label-sm">Remaining</p>
          <p className="mt-2 display-value text-foreground">
            {formatCurrency(progress.remaining)}
          </p>
        </Card>
        <Card>
          <p className="label-sm">Progress</p>
          <p className="mt-2 display-value text-foreground">
            {Math.round(progress.percent)}%
          </p>
        </Card>
        {progress.dailyPaceNeeded !== null && (
          <Card>
            <p className="label-sm">Daily pace needed</p>
            <p className="mt-2 display-value text-foreground">
              {formatCurrency(progress.dailyPaceNeeded)}
            </p>
          </Card>
        )}
        {progress.projectedCompletion && (
          <Card>
            <p className="label-sm">Projected done</p>
            <p className="mt-2 display-value text-foreground">
              {formatDate(progress.projectedCompletion.toISOString().split("T")[0])}
            </p>
          </Card>
        )}
      </div>

      {/* Linked source note */}
      {isLinked && (
        <Card>
          <p className="text-sm text-muted">
            {goal.type === "savings" && linkedAccountName && (
              <>Auto-tracked from <strong className="text-foreground">{linkedAccountName}</strong> balance.</>
            )}
            {goal.type === "debt_payoff" && linkedDebtName && (
              <>Auto-tracked as <strong className="text-foreground">{linkedDebtName}</strong> is paid down.</>
            )}
          </p>
        </Card>
      )}

      {/* Contributions (only for non-linked goals) */}
      {!isLinked && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-sm">Contributions</h2>
            {!addingContrib && (
              <button
                onClick={() => setAddingContrib(true)}
                className="flex items-center gap-1 rounded-lg bg-terracotta px-2.5 py-1.5 text-xs font-medium text-white hover:bg-terracotta-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            )}
          </div>

          {addingContrib && (
            <Card className="mb-3">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={contribAmount}
                    onChange={(e) => setContribAmount(e.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
                  />
                  <input
                    type="date"
                    value={contribDate}
                    onChange={(e) => setContribDate(e.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                  />
                </div>
                <input
                  placeholder="Note (optional)"
                  value={contribNote}
                  onChange={(e) => setContribNote(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setAddingContrib(false)}
                    className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addContribution}
                    className="rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-hover"
                  >
                    Save
                  </button>
                </div>
              </div>
            </Card>
          )}

          {contributions.length === 0 && !addingContrib ? (
            <Card className="text-center py-8">
              <p className="text-sm text-muted">
                No contributions yet. Add one to start tracking progress.
              </p>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-border-subtle">
                {contributions.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground num">
                        +{formatCurrency(Number(c.amount))}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDate(c.date)}
                        {c.note && ` · ${c.note}`}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteContribution(c.id)}
                      className="text-muted hover:text-deficit"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
