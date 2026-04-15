"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, ElevatedCard, StatCard } from "@/components/ui/card";
import { formatCurrency, formatDate, formatRelativeDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Debt, DebtStatement } from "@/lib/types";
import {
  Plus,
  Upload,
  Check,
  TrendingDown,
  CreditCard,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { DebtPayoffStackedChart } from "@/components/charts/debt-payoff-stacked";
import {
  amortize,
  amortizeWithExtra,
  projectPortfolio,
  formatMonthsHuman,
  formatYmdMonth,
  type DebtLike,
  type Strategy,
} from "@/lib/finance/amortization";
import { CHART_COLORS } from "@/components/charts/palette";

type DebtWithColor = Debt & { color?: string | null };

function toDebtLike(d: Debt, fallbackColor?: string): DebtLike {
  return {
    id: d.id,
    current_balance: Number(d.current_balance),
    apr: Number(d.apr),
    minimum_payment: Number(d.minimum_payment),
    creditor: d.creditor,
    nickname: d.nickname,
    color: (d as DebtWithColor).color ?? fallbackColor ?? null,
  };
}

/** Tiny debounce hook — we want the chart to recompute only after the user
 * pauses typing in the "extra/month" input rather than on every keystroke. */
function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

export function DebtModule({
  debts,
  statements,
}: {
  debts: Debt[];
  statements: DebtStatement[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [uploadingDebtId, setUploadingDebtId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>("avalanche");
  const [extraInput, setExtraInput] = useState<string>("0");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const router = useRouter();

  const extraRaw = Number(extraInput);
  const monthlyExtra = Number.isFinite(extraRaw) && extraRaw > 0 ? extraRaw : 0;
  const debouncedExtra = useDebounced(monthlyExtra, 250);

  const debtLikes = useMemo(
    () => debts.map((d, i) => toDebtLike(d, CHART_COLORS[i % CHART_COLORS.length])),
    [debts]
  );

  const totalDebt = debtLikes.reduce((s, d) => s + d.current_balance, 0);
  const totalMinimum = debtLikes.reduce((s, d) => s + d.minimum_payment, 0);
  const weightedApr =
    totalDebt > 0
      ? debtLikes.reduce((s, d) => s + (d.apr * d.current_balance) / totalDebt, 0)
      : 0;

  // Portfolio projections — baseline (min only) and with extras.
  const projMin = useMemo(
    () => projectPortfolio(debtLikes, 0, strategy),
    [debtLikes, strategy]
  );
  const projExtra = useMemo(
    () => projectPortfolio(debtLikes, debouncedExtra, strategy),
    [debtLikes, debouncedExtra, strategy]
  );

  const savedInterest = Math.max(0, projMin.totalInterest - projExtra.totalInterest);
  const monthsSaved = Math.max(0, projMin.months - projExtra.months);

  // How the global extra is allocated this month — whichever debt is the
  // current focus for the chosen strategy gets the whole pool.
  const focusDebtId = useMemo(() => {
    if (debtLikes.length === 0 || debouncedExtra <= 0) return null;
    const ordered = [...debtLikes];
    if (strategy === "avalanche") {
      ordered.sort((a, b) => b.apr - a.apr || b.current_balance - a.current_balance);
    } else {
      ordered.sort((a, b) => a.current_balance - b.current_balance || b.apr - a.apr);
    }
    const first = ordered.find((d) => d.current_balance > 0);
    return first?.id ?? null;
  }, [debtLikes, strategy, debouncedExtra]);

  async function addDebt(formData: FormData) {
    const supabase = createClient();
    await supabase.from("debts").insert({
      book: "personal",
      creditor: formData.get("creditor") as string,
      nickname: (formData.get("nickname") as string) || null,
      current_balance: parseFloat(formData.get("current_balance") as string),
      apr: parseFloat(formData.get("apr") as string),
      minimum_payment: parseFloat(formData.get("minimum_payment") as string),
      statement_due_date: formData.get("statement_due_date") as string,
    });
    setShowForm(false);
    router.refresh();
  }

  async function handleUpload(debtId: string, file: File) {
    setUploading(true);
    const supabase = createClient();

    const filePath = `statements/${debtId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(filePath, file);

    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    const res = await fetch("/api/ocr/parse-statement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_url: filePath, debt_id: debtId }),
    });

    const data = await res.json();

    if (data.statement && data.parsed) {
      const confirmUpdate = confirm(
        `OCR found:\n` +
          `Balance: ${data.parsed.current_balance ? formatCurrency(data.parsed.current_balance) : "N/A"}\n` +
          `Minimum: ${data.parsed.minimum_payment ? formatCurrency(data.parsed.minimum_payment) : "N/A"}\n` +
          `Due: ${data.parsed.due_date || "N/A"}\n\n` +
          `Apply these values to the debt account?`
      );

      if (confirmUpdate) {
        const updates: Record<string, unknown> = {};
        if (data.parsed.current_balance)
          updates.current_balance = data.parsed.current_balance;
        if (data.parsed.minimum_payment)
          updates.minimum_payment = data.parsed.minimum_payment;
        if (data.parsed.due_date)
          updates.statement_due_date = data.parsed.due_date;
        if (data.parsed.apr) updates.apr = data.parsed.apr;

        if (Object.keys(updates).length > 0) {
          await supabase.from("debts").update(updates).eq("id", debtId);
        }

        await supabase
          .from("debt_statements")
          .update({ confirmed: true })
          .eq("id", data.statement.id);
      }
    }

    setUploading(false);
    setUploadingDebtId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Debt Accounts</h1>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              await fetch("/api/plaid/sync-liabilities", { method: "POST" });
              router.refresh();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground hover:bg-card-hover"
          >
            Sync from Plaid
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover"
          >
            <Plus className="h-4 w-4" />
            Add Debt
          </button>
        </div>
      </div>

      {/* Hero: Debt-free date */}
      {debtLikes.length > 0 && totalDebt > 0 && (
        <ElevatedCard accent="terracotta">
          <p className="label-sm">Debt-free date</p>
          {projMin.months >= 600 ? (
            <p className="mt-2 hero-value text-deficit">
              Minimum payments don&apos;t cover interest.
            </p>
          ) : (
            <p className="mt-2 hero-value text-foreground">
              {formatYmdMonth(projMin.payoffDate)}
              <span className="ml-2 text-base font-normal text-muted">
                at current pace ({formatMonthsHuman(projMin.months)})
              </span>
            </p>
          )}
          {debouncedExtra > 0 && projExtra.months < 600 ? (
            <p className="mt-3 text-sm text-muted">
              With{" "}
              <span className="font-semibold text-foreground">
                {formatCurrency(debouncedExtra)}/mo extra
              </span>
              , you&apos;d be debt-free by{" "}
              <span className="font-semibold text-terracotta">
                {formatYmdMonth(projExtra.payoffDate)}
              </span>{" "}
              — saving{" "}
              <span className="font-semibold text-surplus">
                {formatCurrency(savedInterest)}
              </span>{" "}
              in interest,{" "}
              <span className="font-semibold text-surplus">
                {formatMonthsHuman(monthsSaved)}
              </span>{" "}
              sooner.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Add an extra-payment amount below to see how much faster you could
              be debt-free.
            </p>
          )}
        </ElevatedCard>
      )}

      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total Debt"
          value={formatCurrency(totalDebt)}
          color="text-deficit"
        />
        <StatCard
          label="Total Min Payments"
          value={formatCurrency(totalMinimum)}
          color="text-warning"
        />
        <StatCard
          label="Weighted Avg APR"
          value={`${weightedApr.toFixed(1)}%`}
          color="text-muted"
        />
        <StatCard
          label="Projected Interest"
          value={
            projMin.months >= 600
              ? "∞"
              : formatCurrency(projMin.totalInterest)
          }
          subtext="Min payments only"
          color="text-deficit"
        />
      </div>

      {/* Strategy + extras controls */}
      {debtLikes.length > 0 && (
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="label-sm">Strategy</span>
              <div className="flex overflow-hidden rounded-lg border border-border">
                <button
                  onClick={() => setStrategy("avalanche")}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    strategy === "avalanche"
                      ? "bg-terracotta text-white"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  Avalanche
                </button>
                <button
                  onClick={() => setStrategy("snowball")}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    strategy === "snowball"
                      ? "bg-terracotta text-white"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  Snowball
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="label-sm">Extra/month</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  step={25}
                  value={extraInput}
                  onChange={(e) => setExtraInput(e.target.value)}
                  className="w-28 rounded-lg border border-border bg-background pl-6 pr-2 py-1.5 text-sm text-foreground focus:border-terracotta focus:outline-none"
                />
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            {strategy === "avalanche"
              ? "Avalanche puts the extra on the highest-APR debt first."
              : "Snowball puts the extra on the smallest balance first."}
          </p>
        </Card>
      )}

      {/* Timeline chart */}
      {debtLikes.length > 0 && (
        <Card>
          <DebtPayoffStackedChart
            debts={debtLikes}
            monthlyExtra={debouncedExtra}
            strategy={strategy}
          />
        </Card>
      )}

      {showForm && (
        <Card>
          <form action={addDebt} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                name="creditor"
                placeholder="Creditor name"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="nickname"
                placeholder="Nickname (optional)"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="current_balance"
                type="number"
                step="0.01"
                placeholder="Current balance"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="apr"
                type="number"
                step="0.01"
                placeholder="APR %"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="minimum_payment"
                type="number"
                step="0.01"
                placeholder="Minimum payment"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="statement_due_date"
                type="date"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-hover"
              >
                Save
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Debt list */}
      {debts.length === 0 && !showForm ? (
        <Card className="text-center py-12">
          <CreditCard className="mx-auto h-8 w-8 text-muted mb-3" />
          <p className="text-muted">No debt accounts added yet.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {debts.map((debt, i) => {
            const dl = debtLikes[i];
            const color = dl.color ?? CHART_COLORS[i % CHART_COLORS.length];
            const monthlyInterest =
              (dl.current_balance * dl.apr) / 100 / 12;
            const perDebt = projExtra.perDebt[dl.id];
            const allocatedExtra = focusDebtId === dl.id ? debouncedExtra : 0;
            const isExpanded = expandedId === dl.id;
            const debtStatements = statements.filter(
              (s) => s.debt_id === dl.id
            );

            return (
              <Card key={dl.id} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      aria-hidden
                      className="h-8 w-1 flex-shrink-0 rounded-full"
                      style={{ background: color ?? undefined }}
                    />
                    <div className="min-w-0">
                      {debt.account_id ? (
                        <Link
                          href={`/accounts/${debt.account_id}`}
                          className="text-base font-semibold text-foreground hover:text-terracotta transition-colors"
                        >
                          {debt.creditor}
                        </Link>
                      ) : (
                        <h3 className="text-base font-semibold text-foreground">
                          {debt.creditor}
                        </h3>
                      )}
                      {debt.nickname && (
                        <p className="text-xs text-muted truncate">
                          {debt.nickname}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-deficit">
                      {formatCurrency(dl.current_balance)}
                    </p>
                    <p className="text-[11px] text-muted">
                      +{formatCurrency(monthlyInterest)}/mo interest
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
                  <div>
                    <p className="text-xs text-muted">APR</p>
                    <p className="font-medium">{dl.apr.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Min Payment</p>
                    <p className="font-medium">
                      {formatCurrency(dl.minimum_payment)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Next Due</p>
                    <p className="font-medium">
                      {debt.statement_due_date
                        ? formatRelativeDate(debt.statement_due_date)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Payoff</p>
                    <p className="font-medium">
                      {perDebt
                        ? perDebt.months >= 600
                          ? "Never"
                          : formatYmdMonth(perDebt.payoffDate)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Extra this month</p>
                    <p
                      className={`font-medium ${
                        allocatedExtra > 0 ? "text-terracotta" : "text-muted"
                      }`}
                    >
                      {allocatedExtra > 0
                        ? formatCurrency(allocatedExtra)
                        : "—"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border pt-2">
                  <button
                    onClick={() =>
                      setExpandedId(isExpanded ? null : dl.id)
                    }
                    className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    Extra-payment calculator
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <TrendingDown className="h-3.5 w-3.5" />
                      {debtStatements.length} statement
                      {debtStatements.length !== 1 ? "s" : ""}
                    </div>
                    {uploadingDebtId === dl.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          disabled={uploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUpload(dl.id, file);
                          }}
                          className="text-xs text-muted"
                        />
                        {uploading && (
                          <span className="text-xs text-terracotta">
                            Processing...
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setUploadingDebtId(dl.id)}
                        className="flex items-center gap-1.5 text-xs text-muted hover:text-terracotta transition-colors"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Upload Statement
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <PerDebtCalculator debt={dl} />
                )}

                {debtStatements.length > 0 && (
                  <div className="space-y-1 border-t border-border pt-2">
                    {debtStatements.slice(0, 3).map((stmt) => (
                      <div
                        key={stmt.id}
                        className="flex items-center justify-between text-xs py-0.5"
                      >
                        <div className="flex items-center gap-2">
                          {stmt.confirmed ? (
                            <Check className="h-3 w-3 text-surplus" />
                          ) : (
                            <span className="h-3 w-3 rounded-full bg-warning/30" />
                          )}
                          <span className="text-muted">
                            {formatDate(stmt.statement_date)}
                          </span>
                        </div>
                        <div className="flex gap-4 text-muted">
                          {stmt.parsed_balance && (
                            <span>
                              Bal: {formatCurrency(Number(stmt.parsed_balance))}
                            </span>
                          )}
                          {stmt.parsed_minimum && (
                            <span>
                              Min: {formatCurrency(Number(stmt.parsed_minimum))}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {debt.last_synced_at && (
                  <p className="text-[10px] text-muted">
                    Last synced:{" "}
                    {new Date(String(debt.last_synced_at)).toLocaleString()}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Inline per-debt extra-payment what-if. Compares the minimum-only schedule
 * against a user-specified extra payment for this one debt in isolation.
 */
function PerDebtCalculator({ debt }: { debt: DebtLike }) {
  const [extraStr, setExtraStr] = useState("100");
  const extraRaw = Number(extraStr);
  const extra = Number.isFinite(extraRaw) && extraRaw > 0 ? extraRaw : 0;

  const minOnly = useMemo(
    () => amortize(debt.current_balance, debt.apr, debt.minimum_payment),
    [debt]
  );
  const withExtra = useMemo(
    () =>
      amortizeWithExtra(
        debt.current_balance,
        debt.apr,
        debt.minimum_payment,
        { amount: extra, frequency: "monthly" }
      ),
    [debt, extra]
  );

  const savedInterest = Math.max(0, minOnly.totalInterest - withExtra.totalInterest);
  const savedMonths = Math.max(0, minOnly.months - withExtra.months);

  return (
    <div className="rounded-lg border border-border-subtle bg-background/40 p-3 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Add</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">
              $
            </span>
            <input
              type="number"
              min={0}
              step={25}
              value={extraStr}
              onChange={(e) => setExtraStr(e.target.value)}
              className="w-24 rounded-md border border-border bg-background pl-6 pr-2 py-1 text-sm text-foreground focus:border-terracotta focus:outline-none"
            />
          </div>
          <span className="text-xs text-muted">/month to this debt</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] text-muted">Minimum only</p>
          <p className="font-medium">
            {minOnly.months >= 600
              ? "Never"
              : formatMonthsHuman(minOnly.months)}
          </p>
          <p className="text-[11px] text-deficit">
            {minOnly.months >= 600
              ? "—"
              : `${formatCurrency(minOnly.totalInterest)} interest`}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted">With extra</p>
          <p className="font-medium">
            {withExtra.months >= 600
              ? "Never"
              : formatMonthsHuman(withExtra.months)}
          </p>
          <p className="text-[11px] text-deficit">
            {withExtra.months >= 600
              ? "—"
              : `${formatCurrency(withExtra.totalInterest)} interest`}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted">You save</p>
          <p className="font-medium text-surplus">
            {formatCurrency(savedInterest)}
          </p>
          <p className="text-[11px] text-surplus">
            {formatMonthsHuman(savedMonths)} sooner
          </p>
        </div>
      </div>
    </div>
  );
}
