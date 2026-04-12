"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, ElevatedCard } from "@/components/ui/card";
import { BudgetProgressBar } from "@/components/budgets/budget-progress-bar";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  currentPeriodRange,
  daysRemainingInPeriod,
  formatPeriodRange,
} from "@/lib/budgets/compute";
import type {
  Budget,
  BudgetCategory,
  BudgetPeriodRecord,
  Category,
} from "@/lib/types";
import { ArrowLeft, Plus, Pencil, Trash2, Check, X } from "lucide-react";

interface TransactionRow {
  id: string;
  date: string;
  amount: number | string;
  category_id: string | null;
  merchant: string | null;
  description: string | null;
}

interface Props {
  budget: Budget & { budget_categories: BudgetCategory[] };
  categories: Category[];
  transactions: TransactionRow[];
  periods: BudgetPeriodRecord[];
}

export function BudgetDetail({
  budget,
  categories,
  transactions,
  periods,
}: Props) {
  const router = useRouter();
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCatId, setNewCatId] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newRollover, setNewRollover] = useState(false);

  const range = currentPeriodRange(budget);
  const daysLeft = daysRemainingInPeriod(budget);
  const periodLabel = formatPeriodRange(budget).label;

  const catMap = new Map(categories.map((c) => [c.id, c]));

  const spentByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of transactions) {
      if (!t.category_id) continue;
      m.set(t.category_id, (m.get(t.category_id) || 0) + Number(t.amount));
    }
    return m;
  }, [transactions]);

  const totalSpent = useMemo(
    () =>
      budget.budget_categories.reduce(
        (sum, bc) => sum + (spentByCategory.get(bc.category_id) || 0),
        0
      ),
    [budget.budget_categories, spentByCategory]
  );
  const totalAllocated = budget.budget_categories.reduce(
    (sum, bc) => sum + Number(bc.allocated_amount),
    0
  );

  async function saveEdit(bc: BudgetCategory) {
    await fetch(`/api/budgets/${budget.id}/categories/${bc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allocated_amount: Number(editAmount) }),
    });
    setEditingCatId(null);
    router.refresh();
  }

  async function toggleRollover(bc: BudgetCategory) {
    await fetch(`/api/budgets/${budget.id}/categories/${bc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rollover: !bc.rollover }),
    });
    router.refresh();
  }

  async function removeCategory(bc: BudgetCategory) {
    if (!confirm(`Remove ${catMap.get(bc.category_id)?.name || "category"}?`))
      return;
    await fetch(`/api/budgets/${budget.id}/categories/${bc.id}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  async function addCategory() {
    if (!newCatId || !newAmount) return;
    await fetch(`/api/budgets/${budget.id}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category_id: newCatId,
        allocated_amount: Number(newAmount),
        rollover: newRollover,
      }),
    });
    setAdding(false);
    setNewCatId("");
    setNewAmount("");
    setNewRollover(false);
    router.refresh();
  }

  async function deleteBudget() {
    if (!confirm(`Delete budget "${budget.name}"?`)) return;
    await fetch(`/api/budgets/${budget.id}`, { method: "DELETE" });
    router.push("/personal/budgets");
    router.refresh();
  }

  const usedCategoryIds = new Set(
    budget.budget_categories.map((bc) => bc.category_id)
  );
  const availableCategories = categories.filter(
    (c) => !usedCategoryIds.has(c.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/personal/budgets"
          className="flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <button
          onClick={deleteBudget}
          className="text-xs text-muted hover:text-deficit"
        >
          <Trash2 className="inline h-3.5 w-3.5" /> Delete budget
        </button>
      </div>

      <header>
        <p className="label-sm">Budget</p>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{budget.name}</h1>
        <p className="mt-1 text-xs text-muted">
          {periodLabel} · {daysLeft} day{daysLeft === 1 ? "" : "s"} left
        </p>
      </header>

      {/* Overall progress */}
      <ElevatedCard accent="terracotta">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="label-sm">Total Spent</p>
            <p
              className={`mt-2 hero-value ${
                totalSpent > totalAllocated
                  ? "text-deficit"
                  : totalSpent > totalAllocated * 0.8
                    ? "text-warning"
                    : "text-foreground"
              }`}
            >
              {formatCurrency(totalSpent)}
            </p>
          </div>
          <div className="text-right">
            <p className="label-sm">Allocated</p>
            <p className="mt-2 display-value text-muted">
              {formatCurrency(totalAllocated)}
            </p>
          </div>
        </div>
        <BudgetProgressBar spent={totalSpent} allocated={totalAllocated} size="lg" />
      </ElevatedCard>

      {/* Per-category rows */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-sm">Categories</h2>
          {availableCategories.length > 0 && !adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 rounded-lg bg-terracotta px-2.5 py-1.5 text-xs font-medium text-white hover:bg-terracotta-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          )}
        </div>

        {adding && (
          <Card className="mb-3">
            <div className="space-y-3">
              <select
                value={newCatId}
                onChange={(e) => setNewCatId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
              >
                <option value="">Choose category...</option>
                {availableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                placeholder="Amount"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
              />
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={newRollover}
                  onChange={(e) => setNewRollover(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Roll unused budget to next period
              </label>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setAdding(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={addCategory}
                  className="rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-hover"
                >
                  Add
                </button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-2">
          {budget.budget_categories.map((bc) => {
            const cat = catMap.get(bc.category_id);
            const spent = spentByCategory.get(bc.category_id) || 0;
            const allocated = Number(bc.allocated_amount);
            const isEditing = editingCatId === bc.id;

            return (
              <Card key={bc.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {cat?.name || "Unknown"}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      <span className="num">{formatCurrency(spent)}</span> of{" "}
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="inline-block w-20 rounded border border-border bg-background px-1 text-xs text-foreground focus:border-terracotta focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <span className="num">{formatCurrency(allocated)}</span>
                      )}
                      {bc.rollover && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-terracotta">
                          rollover
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => saveEdit(bc)}
                          className="text-surplus hover:text-surplus/80"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setEditingCatId(null)}
                          className="text-muted hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => toggleRollover(bc)}
                          className="text-xs text-muted hover:text-terracotta px-1"
                          title={bc.rollover ? "Rollover on" : "Rollover off"}
                        >
                          ↻
                        </button>
                        <button
                          onClick={() => {
                            setEditingCatId(bc.id);
                            setEditAmount(String(allocated));
                          }}
                          className="text-muted hover:text-terracotta"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => removeCategory(bc)}
                          className="text-muted hover:text-deficit"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <BudgetProgressBar spent={spent} allocated={allocated} />
              </Card>
            );
          })}
        </div>
      </section>

      {/* Historical periods */}
      {periods.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="label-sm">History</h2>
          </div>
          <Card>
            <ul className="divide-y divide-border-subtle">
              {periods.map((p) => {
                const pct = p.total_allocated
                  ? Math.round(
                      (Number(p.total_spent) / Number(p.total_allocated)) * 100
                    )
                  : 0;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm text-foreground">
                        {formatDate(p.period_start)} – {formatDate(p.period_end)}
                      </p>
                      <p className="text-xs text-muted">
                        Status: {p.status}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold num text-foreground">
                        {formatCurrency(Number(p.total_spent))} /{" "}
                        {formatCurrency(Number(p.total_allocated))}
                      </p>
                      <p
                        className={`text-xs num ${pct > 100 ? "text-deficit" : "text-muted"}`}
                      >
                        {pct}%
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
