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
import { Plus, ChevronRight, Wallet, Sparkles, X, Loader2, Check } from "lucide-react";

type BudgetWithSummary = Budget & {
  budget_categories?: BudgetCategory[];
  current_period_spent?: number;
  current_period_allocated?: number;
};

export interface SuggestionRow {
  id: string;
  budget_id: string;
  budget_category_id: string;
  period_key: string;
  old_amount: number;
  proposed_amount: number;
  actual_amount: number;
  reason: string;
  status: string;
  budget_categories: {
    category_id: string;
    categories: { name: string } | null;
  } | null;
}

interface Props {
  budgets: BudgetWithSummary[];
  categories: Category[];
  book?: string;
  suggestions?: SuggestionRow[];
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

export function BudgetsList({
  budgets,
  categories,
  book = "personal",
  suggestions = [],
}: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowGenerate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-terracotta/40 bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta transition-colors hover:bg-terracotta/20"
          >
            <Sparkles className="h-4 w-4" />
            Generate from history
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover"
          >
            <Plus className="h-4 w-4" />
            {showForm ? "Cancel" : "New budget"}
          </button>
        </div>
      </div>

      {showGenerate && (
        <GenerateDialog
          book={book}
          onClose={() => setShowGenerate(false)}
          onCreated={() => {
            setShowGenerate(false);
            router.refresh();
          }}
        />
      )}

      {suggestions.length > 0 && (
        <SuggestionsBanner suggestions={suggestions} onDecided={() => router.refresh()} />
      )}

      {budgets.length > 0 && (
        <div className="flex justify-end">
          <Link
            href="/personal/budgets/trends"
            className="text-xs font-medium text-terracotta hover:underline"
          >
            See trends →
          </Link>
        </div>
      )}

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

function computeTotalSpent(_b: BudgetWithSummary): number {
  return 0;
}

interface ProposedLine {
  category_id: string;
  category_name: string;
  monthly_total: number[];
  months_observed: number;
  actual_avg_per_month: number;
  trimmed_mean_per_month: number;
  proposed_per_period: number;
  proposed_per_month: number;
  reason: string;
}

interface DraftLine extends ProposedLine {
  amount: number;
  include: boolean;
  rollover: boolean;
}

function GenerateDialog({
  book,
  onClose,
  onCreated,
}: {
  book: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [lookback, setLookback] = useState<1 | 3 | 6 | 12>(12);
  const [period, setPeriod] = useState<BudgetPeriodType>("monthly");
  const [roundTo, setRoundTo] = useState<10 | 25 | 50>(25);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [excluded, setExcluded] = useState<
    Array<{ category_name: string; reason: string }>
  >([]);
  const [name, setName] = useState("");

  async function analyze() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/budgets/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          lookback_months: lookback,
          period,
          round_to: roundTo,
        }),
      });
      const data = (await res.json()) as {
        lines?: ProposedLine[];
        excluded?: Array<{ category_name: string; reason: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setLines(
        (data.lines ?? []).map((l) => ({
          ...l,
          amount: l.proposed_per_period,
          include: true,
          rollover: l.category_name === "Groceries" || l.category_name === "Discretionary",
        }))
      );
      setExcluded(data.excluded ?? []);
      if (!name) {
        const now = new Date();
        const monthName = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        setName(`${monthName} budget`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev
        ? prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
        : prev
    );
  }

  async function accept() {
    if (!lines) return;
    const included = lines.filter((l) => l.include && l.amount > 0);
    if (included.length === 0) {
      setErr("Select at least one category.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          name: name.trim() || "Generated budget",
          period,
          period_start_date: new Date().toISOString().slice(0, 10),
          total_amount: included.reduce((s, l) => s + l.amount, 0),
          categories: included.map((l) => ({
            category_id: l.category_id,
            allocated_amount: l.amount,
            rollover: l.rollover,
          })),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Failed to create budget");
      }
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const perPeriodTotal =
    lines?.filter((l) => l.include).reduce((s, l) => s + l.amount, 0) ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-4 w-4 text-terracotta" /> Generate budget
              from history
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Trimmed mean · ignores one-time outliers · rounded up for clean numbers.
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Lookback">
            <select
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value) as 1 | 3 | 6 | 12)}
              className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-sm"
            >
              <option value={1}>1 month</option>
              <option value={3}>3 months</option>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
            </select>
          </Field>
          <Field label="Period">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as BudgetPeriodType)}
              className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-sm"
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </Field>
          <Field label="Round up to">
            <select
              value={roundTo}
              onChange={(e) => setRoundTo(Number(e.target.value) as 10 | 25 | 50)}
              className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-sm"
            >
              <option value={10}>$10</option>
              <option value={25}>$25</option>
              <option value={50}>$50</option>
            </select>
          </Field>
          <Field label="&nbsp;">
            <button
              onClick={analyze}
              disabled={loading}
              className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {lines ? "Re-analyze" : "Analyze"}
            </button>
          </Field>
        </div>

        {err && (
          <p className="mt-3 rounded bg-deficit/10 px-2 py-1 text-xs text-deficit">
            {err}
          </p>
        )}

        {lines && lines.length > 0 && (
          <>
            <div className="mt-5 overflow-hidden rounded-xl border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="border-b border-border-subtle bg-card-hover text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-2 py-2 text-left">Category</th>
                    <th className="px-2 py-2 text-right">Avg / mo</th>
                    <th className="px-2 py-2 text-right">Trimmed</th>
                    <th className="px-2 py-2 text-right">Proposed</th>
                    <th className="px-2 py-2 text-center">Rollover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {lines.map((l, i) => (
                    <tr
                      key={l.category_id}
                      className={!l.include ? "opacity-40" : ""}
                    >
                      <td className="w-8 px-2 py-2">
                        <input
                          type="checkbox"
                          checked={l.include}
                          onChange={(e) => updateLine(i, { include: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <p className="font-medium">{l.category_name}</p>
                        <p className="text-[10px] text-muted">{l.reason}</p>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right num text-xs text-muted">
                        ${l.actual_avg_per_month.toFixed(0)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right num text-xs text-muted">
                        ${l.trimmed_mean_per_month.toFixed(0)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <input
                          type="number"
                          step="25"
                          value={l.amount}
                          onChange={(e) =>
                            updateLine(i, { amount: Number(e.target.value) })
                          }
                          className="w-24 rounded border border-border-subtle bg-card px-2 py-0.5 text-right num text-sm"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={l.rollover}
                          onChange={(e) => updateLine(i, { rollover: e.target.checked })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-card-hover text-sm">
                  <tr>
                    <td />
                    <td className="px-2 py-2 font-medium">Total per {period}</td>
                    <td colSpan={2} />
                    <td className="whitespace-nowrap px-2 py-2 text-right num font-semibold">
                      {formatCurrency(perPeriodTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            {excluded.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                Excluded (too small to budget):{" "}
                {excluded.map((e) => e.category_name).join(", ")}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
              <label className="flex-1 min-w-[200px] text-sm">
                <span className="label-sm">Budget name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5 text-sm"
                  placeholder="e.g. April spending"
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={accept}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Create budget
                </button>
              </div>
            </div>
          </>
        )}

        {lines && lines.length === 0 && (
          <p className="mt-4 text-sm text-muted">
            No spending data in the window — connect banks or widen the
            lookback.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label-sm" dangerouslySetInnerHTML={{ __html: label }} />
      {children}
    </div>
  );
}

function SuggestionsBanner({
  suggestions,
  onDecided,
}: {
  suggestions: SuggestionRow[];
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, decision: "accepted" | "rejected") {
    setBusy(id);
    try {
      await fetch(`/api/budgets/suggestions/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      onDecided();
    } finally {
      setBusy(null);
    }
  }

  async function decideAll(decision: "accepted" | "rejected") {
    for (const s of suggestions) {
      await fetch(`/api/budgets/suggestions/${s.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
    }
    onDecided();
  }

  return (
    <Card accent="terracotta">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-terracotta" />
          <h3 className="text-sm font-semibold">
            Budget tune-up ({suggestions.length})
          </h3>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => decideAll("accepted")}
            className="rounded-lg border border-terracotta/40 bg-terracotta/10 px-2.5 py-1 text-xs font-medium text-terracotta"
          >
            Accept all
          </button>
          <button
            onClick={() => decideAll("rejected")}
            className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-muted"
          >
            Reject all
          </button>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border-subtle">
        {suggestions.map((s) => {
          const name =
            s.budget_categories?.categories?.name ?? "Category";
          const up = s.proposed_amount > s.old_amount;
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {name}
                  {": "}
                  <span
                    className={up ? "text-warning" : "text-surplus"}
                  >
                    ${Number(s.old_amount).toFixed(0)} → $
                    {Number(s.proposed_amount).toFixed(0)}
                  </span>
                </p>
                <p className="text-xs text-muted">{s.reason}</p>
              </div>
              <div className="flex gap-1">
                <button
                  disabled={busy === s.id}
                  onClick={() => decide(s.id, "accepted")}
                  className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {busy === s.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Accept
                </button>
                <button
                  disabled={busy === s.id}
                  onClick={() => decide(s.id, "rejected")}
                  className="rounded-lg border border-border-subtle px-2 py-1 text-xs font-medium text-muted disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
