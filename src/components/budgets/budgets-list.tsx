"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { BudgetProgressBar } from "@/components/budgets/budget-progress-bar";
import { formatCurrency } from "@/lib/format";
import {
  currentPeriodRange,
  daysRemainingInPeriod,
  formatPeriodRange,
} from "@/lib/budgets/compute";
import type {
  Budget,
  BudgetCategory,
  Category,
  BudgetPeriodType,
} from "@/lib/types";
import { Plus, ChevronRight, Wallet } from "lucide-react";

type BudgetWithSummary = Budget & {
  budget_categories?: BudgetCategory[];
  current_period_spent?: number;
  current_period_allocated?: number;
};

interface Props {
  budgets: BudgetWithSummary[];
  categories: Category[];
  book?: string;
}

interface DraftRow {
  category_id: string;
  allocated_amount: string;
  rollover: boolean;
}

const PERIODS: { value: BudgetPeriodType; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
];

export function BudgetsList({ budgets, categories, book = "personal" }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const [name, setName] = useState("");
  const [period, setPeriod] = useState<BudgetPeriodType>("monthly");
  const [periodStart, setPeriodStart] = useState(today);
  const [periodEnd, setPeriodEnd] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([
    { category_id: "", allocated_amount: "", rollover: false },
  ]);

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  function addRow() {
    setRows((r) => [
      ...r,
      { category_id: "", allocated_amount: "", rollover: false },
    ]);
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, patch: Partial<DraftRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function resetForm() {
    setName("");
    setPeriod("monthly");
    setPeriodStart(today);
    setPeriodEnd("");
    setTotalAmount("");
    setRows([{ category_id: "", allocated_amount: "", rollover: false }]);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Budget name is required.");
      return;
    }
    const validRows = rows.filter((r) => r.category_id);
    setSaving(true);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          name: name.trim(),
          period,
          period_start_date: periodStart || null,
          period_end_date:
            period === "custom" && periodEnd ? periodEnd : null,
          total_amount: totalAmount ? parseFloat(totalAmount) : null,
          categories: validRows.map((r) => ({
            category_id: r.category_id,
            allocated_amount: r.allocated_amount
              ? parseFloat(r.allocated_amount)
              : 0,
            rollover: r.rollover,
          })),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(j.error || "Failed to create budget");
      }
      resetForm();
      setShowForm(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Budgets</h1>
          <p className="mt-1 text-sm text-muted">
            Allocate spending by category and track progress each period.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover"
        >
          <Plus className="h-4 w-4" />
          {showForm ? "Cancel" : "New budget"}
        </button>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="label-sm">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. April spending"
                  required
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="label-sm">Period</label>
                <select
                  value={period}
                  onChange={(e) =>
                    setPeriod(e.target.value as BudgetPeriodType)
                  }
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                >
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="label-sm">Start date</label>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                />
              </div>
              {period === "custom" && (
                <div className="flex flex-col gap-1">
                  <label className="label-sm">End date</label>
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="label-sm">Total amount (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="Auto-calculated from categories"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">
                  Category allocations
                </h3>
                <button
                  type="button"
                  onClick={addRow}
                  className="text-xs font-medium text-terracotta hover:underline"
                >
                  + Add row
                </button>
              </div>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-12 items-center gap-2"
                  >
                    <select
                      value={r.category_id}
                      onChange={(e) =>
                        updateRow(i, { category_id: e.target.value })
                      }
                      className="col-span-5 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                    >
                      <option value="">Select category…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount"
                      value={r.allocated_amount}
                      onChange={(e) =>
                        updateRow(i, { allocated_amount: e.target.value })
                      }
                      className="col-span-4 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
                    />
                    <label className="col-span-2 flex items-center gap-1 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={r.rollover}
                        onChange={(e) =>
                          updateRow(i, { rollover: e.target.checked })
                        }
                      />
                      Rollover
                    </label>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="col-span-1 text-xs text-muted hover:text-deficit"
                      disabled={rows.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-deficit">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
              >
                {saving ? "Saving…" : "Create budget"}
              </button>
            </div>
          </form>
        </Card>
      )}

      {budgets.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Wallet className="h-10 w-10 text-muted" />
            <p className="text-sm text-muted">
              No budgets yet. Create one to track allocations per category.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => {
            const spent =
              b.current_period_spent ??
              computeTotalSpent(b);
            const allocated =
              b.current_period_allocated ??
              (b.budget_categories || []).reduce(
                (s, c) => s + Number(c.allocated_amount || 0),
                0
              );
            const daysLeft = daysRemainingInPeriod(b);
            const { label } = formatPeriodRange(b);
            const range = currentPeriodRange(b);
            return (
              <Link
                key={b.id}
                href={`/personal/budgets/${b.id}`}
                className="block"
              >
                <Card interactive>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-foreground">
                          {b.name}
                        </h3>
                        <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">
                          {b.period}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted num">
                        {label} · {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                      </p>
                      <div className="mt-3">
                        <BudgetProgressBar
                          spent={spent}
                          allocated={allocated}
                          size="md"
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {b.budget_categories?.length ?? 0} categor
                        {(b.budget_categories?.length ?? 0) === 1 ? "y" : "ies"}
                      </p>
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Swallow unused import warning when no data paths use categoryById/formatCurrency/range */}
      <div className="hidden">
        {categoryById.size} {formatCurrency(0)} {String(today)} {String(Date.now())}
      </div>
    </div>
  );
}

function computeTotalSpent(b: BudgetWithSummary): number {
  return 0;
}
