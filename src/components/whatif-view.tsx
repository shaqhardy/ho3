"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, ElevatedCard } from "@/components/ui/card";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { BOOK_LABELS } from "@/lib/books";
import {
  computeProjection,
  compareProjections,
  type Scenario,
} from "@/lib/projection/engine";
import type {
  Account,
  Bill,
  Category,
  ConfidenceLevel,
  Debt,
  ProjectedIncome,
  Subscription,
} from "@/lib/types";
import {
  AlertTriangle,
  Beaker,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Wand,
  X,
} from "lucide-react";

type WhatIfBook = "personal" | "business" | "nonprofit" | "cross-book";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface WhatIfViewProps {
  book: WhatIfBook;
  bookLabel?: string;
  currentCash: number;
  bills: Bill[];
  subscriptions: Subscription[];
  debts: Debt[];
  projectedIncome: ProjectedIncome[];
  categories: Category[];
  accounts: Account[];
}

type ScenarioType = "expense" | "income";

interface NewScenarioForm {
  type: ScenarioType;
  name: string;
  amount: string;
  date: string;
  account_id: string;
  category_id: string;
  note: string;
  confidence: "high" | "medium" | "low" | "";
  override_full_amount: boolean;
  source: string;
  is_saved: boolean;
}

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  confirmed: "confirmed",
  expected: "expected",
  tentative: "tentative",
};

const CONFIDENCE_PERCENT: Record<ConfidenceLevel, string> = {
  confirmed: "100%",
  expected: "75%",
  tentative: "50%",
};

function confidenceFromSelect(
  v: "high" | "medium" | "low" | ""
): ConfidenceLevel | null {
  if (v === "high") return "confirmed";
  if (v === "medium") return "expected";
  if (v === "low") return "tentative";
  return null;
}

function todayString() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

function emptyForm(type: ScenarioType = "expense"): NewScenarioForm {
  return {
    type,
    name: "",
    amount: "",
    date: todayString(),
    account_id: "",
    category_id: "",
    note: "",
    confidence: "",
    override_full_amount: false,
    source: "",
    is_saved: false,
  };
}

/**
 * Full What If view — comparison cards + add form + active & saved scenario lists.
 */
export function WhatIfView({
  book,
  bookLabel: bookLabelProp,
  currentCash,
  bills,
  subscriptions,
  debts,
  projectedIncome,
  categories,
  accounts,
}: WhatIfViewProps) {
  const bookLabel =
    bookLabelProp ??
    (book === "cross-book" ? "Overview" : BOOK_LABELS[book]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<NewScenarioForm>(() => emptyForm("expense"));
  const [saving, setSaving] = useState(false);

  const [promoteTarget, setPromoteTarget] = useState<Scenario | null>(null);
  const [promoting, setPromoting] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // Fetch scenarios on mount + whenever book changes
  useEffect(() => {
    let aborted = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `/api/scenarios?book=${encodeURIComponent(book)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { scenarios?: Scenario[] };
        if (aborted) return;
        setScenarios(json.scenarios ?? []);
      } catch (err) {
        if (aborted) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    load();
    return () => {
      aborted = true;
    };
  }, [book]);

  // Projections — base (no scenarios) and with active scenarios
  const baseProjection = useMemo(
    () =>
      computeProjection({
        currentCash,
        bills,
        subscriptions,
        debts,
        projectedIncome,
      }),
    [currentCash, bills, subscriptions, debts, projectedIncome]
  );

  const withProjection = useMemo(
    () =>
      computeProjection({
        currentCash,
        bills,
        subscriptions,
        debts,
        projectedIncome,
        scenarios,
      }),
    [currentCash, bills, subscriptions, debts, projectedIncome, scenarios]
  );

  const diff = useMemo(
    () => compareProjections(baseProjection, withProjection),
    [baseProjection, withProjection]
  );

  const activeScenarios = useMemo(
    () =>
      [...scenarios].sort((a, b) =>
        (a.date || "").localeCompare(b.date || "")
      ),
    [scenarios]
  );

  const savedScenarios = useMemo(
    () => scenarios.filter((s) => isSaved(s)),
    [scenarios]
  );

  // --- Mutations (optimistic) ---

  const togglePatch = useCallback(
    async (id: string, patch: Partial<Scenario>) => {
      setScenarios((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      );
      try {
        const res = await fetch(`/api/scenarios/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { scenario?: Scenario };
        if (json.scenario) {
          setScenarios((prev) =>
            prev.map((s) => (s.id === id ? json.scenario! : s))
          );
        }
      } catch (err) {
        pushToast("error", "Couldn't save change. Reloading…");
        // Re-fetch to get truth
        try {
          const res = await fetch(
            `/api/scenarios?book=${encodeURIComponent(book)}`,
            { cache: "no-store" }
          );
          const json = (await res.json()) as { scenarios?: Scenario[] };
          setScenarios(json.scenarios ?? []);
        } catch {
          // swallow — toast already shown
        }
        console.error(err);
      }
    },
    [book, pushToast]
  );

  const deleteScenario = useCallback(
    async (id: string) => {
      const prev = scenarios;
      setScenarios((p) => p.filter((s) => s.id !== id));
      try {
        const res = await fetch(`/api/scenarios/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pushToast("success", "Scenario deleted.");
      } catch (err) {
        setScenarios(prev);
        pushToast("error", "Couldn't delete scenario.");
        console.error(err);
      }
    },
    [scenarios, pushToast]
  );

  const promoteScenario = useCallback(
    async (id: string) => {
      setPromoting(true);
      try {
        const res = await fetch(`/api/scenarios/${id}/promote`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          success?: boolean;
          promoted_to?: string;
        };
        pushToast(
          "success",
          json.promoted_to
            ? `Promoted to ${json.promoted_to.replace("_", " ")}.`
            : "Made it real."
        );
        // Refresh list
        const listRes = await fetch(
          `/api/scenarios?book=${encodeURIComponent(book)}`,
          { cache: "no-store" }
        );
        if (listRes.ok) {
          const j = (await listRes.json()) as { scenarios?: Scenario[] };
          setScenarios(j.scenarios ?? []);
        }
        setPromoteTarget(null);
      } catch (err) {
        pushToast("error", "Couldn't promote scenario.");
        console.error(err);
      } finally {
        setPromoting(false);
      }
    },
    [book, pushToast]
  );

  const submitNew = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (saving) return;
      if (!form.name.trim()) {
        pushToast("error", "Name is required.");
        return;
      }
      const amount = parseFloat(form.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        pushToast("error", "Amount must be a positive number.");
        return;
      }

      setSaving(true);
      const confidence = confidenceFromSelect(form.confidence);
      const payload = {
        book: book === "cross-book" ? "personal" : book,
        type: form.type,
        name: form.name.trim(),
        amount,
        date: form.date || todayString(),
        source: form.type === "income" ? form.source || form.name.trim() : null,
        confidence: confidence,
        override_full_amount: form.override_full_amount,
        account_id: form.account_id || null,
        category_id: form.category_id || null,
        note: form.note.trim() || null,
        is_saved: form.is_saved,
      };
      try {
        const res = await fetch("/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { scenario?: Scenario };
        if (json.scenario) {
          setScenarios((prev) => [json.scenario!, ...prev]);
        }
        setForm(emptyForm(form.type));
        setShowAdd(false);
        pushToast("success", "Scenario added.");
      } catch (err) {
        pushToast("error", "Couldn't create scenario.");
        console.error(err);
      } finally {
        setSaving(false);
      }
    },
    [book, form, saving, pushToast]
  );

  const scenarioBookCategories = useMemo(() => {
    if (book === "cross-book") return categories;
    return categories.filter((c) => c.book === book);
  }, [book, categories]);

  const scenarioBookAccounts = useMemo(() => {
    if (book === "cross-book") return accounts;
    return accounts.filter((a) => a.book === book);
  }, [book, accounts]);

  return (
    <div className="has-bottom-nav space-y-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="label-sm">{bookLabel} · What If</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Play with scenarios
          </h1>
          <p className="mt-2 text-sm text-muted max-w-2xl">
            Add hypothetical income or expenses and see how they change your
            runway before committing. Nothing here is real until you &ldquo;Make
            it real.&rdquo;
          </p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-terracotta-hover"
        >
          {showAdd ? (
            <>
              <X className="h-4 w-4" />
              Close
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Add scenario
            </>
          )}
        </button>
      </header>

      {/* Comparison cards */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-sm">Projection (next 30 days)</h2>
          {loading && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Loader className="h-3 w-3 animate-spin" />
              Loading
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card accent="none" className="space-y-3">
            <p className="label-sm">Current</p>
            <p className="display-value text-foreground">
              {formatCurrency(diff.baseEndBalance)}
            </p>
            <ShortfallSummary shortfalls={baseProjection.shortfalls} />
          </Card>
          <Card accent="terracotta" className="space-y-3">
            <p className="label-sm inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-terracotta" />
              With Scenarios
            </p>
            <p
              className={`display-value ${
                diff.scenarioEndBalance >= 0 ? "text-foreground" : "text-deficit"
              }`}
            >
              {formatCurrency(diff.scenarioEndBalance)}
            </p>
            <p className="text-xs text-muted num">
              {diff.endBalanceDelta === 0
                ? "No active scenarios (same as current)."
                : diff.endBalanceDelta > 0
                  ? `+${formatCurrency(diff.endBalanceDelta)} vs current`
                  : `${formatCurrency(diff.endBalanceDelta)} vs current`}
            </p>
            <ShortfallSummary shortfalls={withProjection.shortfalls} />
            {diff.newShortfalls.length > 0 && (
              <div className="rounded-lg border border-deficit/30 bg-deficit/5 px-3 py-2 text-xs text-deficit">
                Adds {diff.newShortfalls.length} new shortfall
                {diff.newShortfalls.length !== 1 ? "s" : ""} starting{" "}
                {formatShortDate(diff.newShortfalls[0].date)}.
              </div>
            )}
            {diff.erasedShortfalls.length > 0 && (
              <div className="rounded-lg border border-surplus/30 bg-surplus/5 px-3 py-2 text-xs text-surplus">
                Erases {diff.erasedShortfalls.length} shortfall
                {diff.erasedShortfalls.length !== 1 ? "s" : ""}.
              </div>
            )}
          </Card>
        </div>
      </section>

      {loadError && (
        <div className="rounded-lg border border-deficit/30 bg-deficit/5 px-4 py-3 text-sm text-deficit">
          Couldn&apos;t load scenarios: {loadError}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <AddScenarioForm
          form={form}
          setForm={setForm}
          categories={scenarioBookCategories}
          accounts={scenarioBookAccounts}
          onCancel={() => {
            setShowAdd(false);
            setForm(emptyForm(form.type));
          }}
          onSubmit={submitNew}
          saving={saving}
        />
      )}

      {/* Active scenario list */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-sm">
            Scenarios{" "}
            {activeScenarios.length > 0 && (
              <span className="ml-1 text-xs text-muted num">
                ({activeScenarios.length})
              </span>
            )}
          </h2>
        </div>
        {loading && activeScenarios.length === 0 ? (
          <Card className="py-6 text-center text-sm text-muted">
            Loading scenarios…
          </Card>
        ) : activeScenarios.length === 0 ? (
          <Card className="py-10 text-center">
            <Beaker className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm font-medium text-foreground">
              No scenarios yet
            </p>
            <p className="mt-1 text-xs text-muted max-w-xs mx-auto">
              Add a hypothetical income or expense to see how it would change
              your plan.
            </p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {activeScenarios.map((sc) => (
              <ScenarioRow
                key={sc.id}
                scenario={sc}
                onToggleActive={(v) =>
                  togglePatch(sc.id, { is_active: v })
                }
                onToggleSaved={(v) => togglePatch(sc.id, savedPatch(sc, v))}
                onDelete={() => deleteScenario(sc.id)}
                onPromote={() => setPromoteTarget(sc)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Saved scenarios */}
      {savedScenarios.length > 0 && (
        <section>
          <button
            onClick={() => setSavedOpen((v) => !v)}
            className="mb-3 flex w-full items-center justify-between"
            aria-expanded={savedOpen}
          >
            <h2 className="label-sm inline-flex items-center gap-1.5">
              <Star className="h-3 w-3 text-warning" />
              Saved for later
              <span className="ml-1 text-xs text-muted num">
                ({savedScenarios.length})
              </span>
            </h2>
            {savedOpen ? (
              <ChevronDown className="h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted" />
            )}
          </button>
          {savedOpen && (
            <ul className="space-y-2">
              {savedScenarios.map((sc) => (
                <ScenarioRow
                  key={`saved-${sc.id}`}
                  scenario={sc}
                  compact
                  onToggleActive={(v) =>
                    togglePatch(sc.id, { is_active: v })
                  }
                  onToggleSaved={(v) => togglePatch(sc.id, savedPatch(sc, v))}
                  onDelete={() => deleteScenario(sc.id)}
                  onPromote={() => setPromoteTarget(sc)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Promote confirmation */}
      {promoteTarget && (
        <PromoteConfirm
          scenario={promoteTarget}
          busy={promoting}
          onCancel={() => setPromoteTarget(null)}
          onConfirm={() => promoteScenario(promoteTarget.id)}
        />
      )}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
                t.kind === "success"
                  ? "border-surplus/40 bg-surplus/10 text-surplus"
                  : t.kind === "error"
                    ? "border-deficit/40 bg-deficit/10 text-deficit"
                    : "border-terracotta/40 bg-terracotta/10 text-terracotta"
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Helpers — the Scenario type doesn't have an `is_saved` field in the engine,
// but the API/table supports it. Store under a loose accessor so we don't
// break the engine's strict typing.
function isSaved(s: Scenario): boolean {
  return Boolean((s as Scenario & { is_saved?: boolean }).is_saved);
}

function savedPatch(_s: Scenario, v: boolean): Partial<Scenario> {
  return { is_saved: v } as Partial<Scenario>;
}

function ShortfallSummary({
  shortfalls,
}: {
  shortfalls: { date: string; balanceAfter: number }[];
}) {
  if (shortfalls.length === 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-surplus">
        <CheckCircle className="h-3.5 w-3.5" />
        No shortfalls
      </p>
    );
  }
  const first = shortfalls[0];
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-deficit">
      <AlertTriangle className="h-3.5 w-3.5" />
      {shortfalls.length} shortfall{shortfalls.length !== 1 ? "s" : ""} ·
      first {formatShortDate(first.date)}
    </p>
  );
}

function ScenarioRow({
  scenario,
  onToggleActive,
  onToggleSaved,
  onDelete,
  onPromote,
  compact = false,
}: {
  scenario: Scenario;
  onToggleActive: (next: boolean) => void;
  onToggleSaved: (next: boolean) => void;
  onDelete: () => void;
  onPromote: () => void;
  compact?: boolean;
}) {
  const isIncome = scenario.type === "income";
  const sign = isIncome ? "+" : "-";
  const signClass = isIncome ? "text-surplus" : "text-deficit";
  const confidence = scenario.confidence;

  return (
    <li>
      <Card
        className={`flex items-center gap-3 py-3 px-4 ${
          scenario.is_active ? "" : "opacity-60"
        }`}
      >
        <Switch
          checked={scenario.is_active}
          onChange={onToggleActive}
          label={`Toggle scenario ${scenario.name}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {scenario.name}
            </p>
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                isIncome
                  ? "bg-surplus/10 text-surplus"
                  : "bg-deficit/10 text-deficit"
              }`}
            >
              {isIncome ? "Income" : "Expense"}
            </span>
            {isIncome && confidence && (
              <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-card-hover text-muted">
                {CONFIDENCE_LABEL[confidence]} ·{" "}
                {scenario.override_full_amount
                  ? "100%"
                  : CONFIDENCE_PERCENT[confidence]}
              </span>
            )}
          </div>
          {!compact && (
            <p className="mt-0.5 text-xs text-muted">
              {formatShortDate(scenario.date)}
              {scenario.note ? ` · ${scenario.note}` : ""}
            </p>
          )}
        </div>

        <p className={`text-sm font-semibold num ${signClass}`}>
          {sign}
          {formatCurrency(Math.abs(Number(scenario.amount)))}
        </p>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleSaved(!isSaved(scenario))}
            className={`rounded p-1.5 transition-colors ${
              isSaved(scenario)
                ? "text-warning hover:bg-warning/10"
                : "text-muted hover:text-warning hover:bg-card-hover"
            }`}
            aria-label={isSaved(scenario) ? "Unsave" : "Save for later"}
            title={isSaved(scenario) ? "Unsave" : "Save for later"}
          >
            <Star
              className="h-4 w-4"
              fill={isSaved(scenario) ? "currentColor" : "none"}
            />
          </button>
          <button
            type="button"
            onClick={onPromote}
            className="rounded p-1.5 text-muted transition-colors hover:bg-terracotta/10 hover:text-terracotta"
            aria-label="Make it real"
            title="Make it real"
          >
            <Wand className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1.5 text-muted transition-colors hover:bg-deficit/10 hover:text-deficit"
            aria-label="Delete scenario"
            title="Delete scenario"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </Card>
    </li>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-terracotta" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function AddScenarioForm({
  form,
  setForm,
  categories,
  accounts,
  onCancel,
  onSubmit,
  saving,
}: {
  form: NewScenarioForm;
  setForm: React.Dispatch<React.SetStateAction<NewScenarioForm>>;
  categories: Category[];
  accounts: Account[];
  onCancel: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const isIncome = form.type === "income";
  return (
    <ElevatedCard accent="terracotta">
      <form onSubmit={onSubmit} className="space-y-4">
        {/* Type toggle */}
        <div className="inline-flex rounded-lg border border-border bg-card overflow-hidden">
          {(["expense", "income"] as ScenarioType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setForm((f) => ({ ...f, type: t }))}
              className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                form.type === t
                  ? "bg-terracotta text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabeledInput
            label={isIncome ? "Source" : "Name"}
            required
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder={isIncome ? "Freelance payment" : "New laptop"}
          />
          <LabeledInput
            label="Amount"
            required
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
            placeholder="0.00"
          />
          <LabeledInput
            label="Date"
            type="date"
            value={form.date}
            onChange={(v) => setForm((f) => ({ ...f, date: v }))}
          />
          {!isIncome && (
            <LabeledSelect
              label="Category"
              value={form.category_id}
              onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
              options={[
                { value: "", label: "Uncategorized" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          )}
          {isIncome && (
            <LabeledSelect
              label="Confidence"
              required
              value={form.confidence}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  confidence: v as NewScenarioForm["confidence"],
                }))
              }
              options={[
                { value: "", label: "Select…" },
                { value: "high", label: "High (confirmed · 100%)" },
                { value: "medium", label: "Medium (expected · 75%)" },
                { value: "low", label: "Low (tentative · 50%)" },
              ]}
            />
          )}
          <LabeledSelect
            label={isIncome ? "Deposit account (optional)" : "Account (optional)"}
            value={form.account_id}
            onChange={(v) => setForm((f) => ({ ...f, account_id: v }))}
            options={[
              { value: "", label: "—" },
              ...accounts.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </div>

        {isIncome && (
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.override_full_amount}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  override_full_amount: e.target.checked,
                }))
              }
              className="mt-0.5 h-4 w-4 accent-terracotta"
            />
            <span>
              Override confidence — use full amount in projection
              <span className="block text-xs text-muted">
                By default income is multiplied by its confidence level.
              </span>
            </span>
          </label>
        )}

        <LabeledTextarea
          label="Note (optional)"
          value={form.note}
          onChange={(v) => setForm((f) => ({ ...f, note: v }))}
          placeholder="Any context you want to remember…"
        />

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={form.is_saved}
            onChange={(e) =>
              setForm((f) => ({ ...f, is_saved: e.target.checked }))
            }
            className="h-4 w-4 accent-terracotta"
          />
          <span>Save for later</span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Add scenario
              </>
            )}
          </button>
        </div>
      </form>
    </ElevatedCard>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  required = false,
  placeholder,
  type = "text",
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  type?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="label-sm">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label-sm">{label}</span>
      <select
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="label-sm">{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
      />
    </label>
  );
}

function PromoteConfirm({
  scenario,
  busy,
  onCancel,
  onConfirm,
}: {
  scenario: Scenario;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isIncome = scenario.type === "income";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-terracotta/15">
            <Wand className="h-5 w-5 text-terracotta" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">
              Make it real?
            </h3>
            <p className="mt-1 text-sm text-muted">
              This will promote{" "}
              <span className="font-medium text-foreground">
                {scenario.name}
              </span>{" "}
              to a real{" "}
              {isIncome ? "projected income entry" : "bill or transaction"} and
              archive the scenario.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader className="h-3.5 w-3.5 animate-spin" />
                Promoting…
              </>
            ) : (
              <>
                <Wand className="h-3.5 w-3.5" />
                Make it real
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Embeddable panel for the Plan view — a single toggle + brief delta summary.
 * Accepts either `scenarios` directly or fetches via `book`.
 */
export function WhatIfPanel({
  book,
  currentCash,
  bills,
  subscriptions,
  debts,
  projectedIncome,
  scenarios: scenariosProp,
  include,
  onIncludeChange,
}: {
  book: WhatIfBook;
  currentCash: number;
  bills: Bill[];
  subscriptions: Subscription[];
  debts: Debt[];
  projectedIncome: ProjectedIncome[];
  scenarios?: Scenario[];
  include: boolean;
  onIncludeChange: (next: boolean) => void;
}) {
  const [fetchedScenarios, setFetchedScenarios] = useState<Scenario[] | null>(
    null
  );

  // Prefer the prop when supplied; otherwise fall back to what we fetched.
  // Memoised so its identity is stable across renders when the underlying
  // reference doesn't change.
  const scenarios = useMemo<Scenario[]>(
    () => scenariosProp ?? fetchedScenarios ?? [],
    [scenariosProp, fetchedScenarios]
  );

  useEffect(() => {
    if (scenariosProp) return; // parent-provided, no fetch needed
    if (!include) return;
    if (fetchedScenarios !== null) return;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/scenarios?book=${encodeURIComponent(book)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = (await res.json()) as { scenarios?: Scenario[] };
        if (!aborted) {
          setFetchedScenarios(json.scenarios ?? []);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      aborted = true;
    };
  }, [book, include, fetchedScenarios, scenariosProp]);

  const base = useMemo(
    () =>
      computeProjection({
        currentCash,
        bills,
        subscriptions,
        debts,
        projectedIncome,
      }),
    [currentCash, bills, subscriptions, debts, projectedIncome]
  );

  const withScen = useMemo(
    () =>
      computeProjection({
        currentCash,
        bills,
        subscriptions,
        debts,
        projectedIncome,
        scenarios,
      }),
    [currentCash, bills, subscriptions, debts, projectedIncome, scenarios]
  );

  const diff = useMemo(() => compareProjections(base, withScen), [base, withScen]);
  const active = scenarios.filter((s) => s.is_active).length;

  return (
    <Card
      accent={include ? "terracotta" : "none"}
      className="flex items-center gap-3"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-terracotta/10 text-terracotta">
        <Beaker className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          Include What If scenarios
        </p>
        <p className="text-xs text-muted">
          {include
            ? active > 0
              ? `${active} active · ${
                  diff.endBalanceDelta >= 0 ? "+" : ""
                }${formatCurrency(diff.endBalanceDelta)} end-of-period`
              : "No active scenarios."
            : "Toggle to see how pending scenarios affect your plan."}
        </p>
      </div>
      <Link
        href={`/${book === "cross-book" ? "overview" : book}/whatif`}
        className="hidden sm:inline-flex text-xs font-medium text-terracotta hover:underline"
      >
        Manage
      </Link>
      <Switch
        checked={include}
        onChange={onIncludeChange}
        label="Include What If scenarios"
      />
    </Card>
  );
}

/** Small terracotta "WHAT IF" badge to mark hypothetical items. */
export function WhatIfBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest bg-terracotta/10 text-terracotta ${className}`}
    >
      What if
    </span>
  );
}
