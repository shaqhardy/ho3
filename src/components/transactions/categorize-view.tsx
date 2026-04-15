"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ElevatedCard } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { Check, Loader2, Sparkles, Wand2 } from "lucide-react";
import { BOOK_LABELS } from "@/lib/books";

type Book = "personal" | "business" | "nonprofit";

interface TxnLite {
  id: string;
  merchant: string | null;
  description: string | null;
  amount: number | string;
  date: string;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  is_income: boolean;
}

interface Completeness {
  total: number;
  categorized: number;
  uncategorized: number;
  pct_of_expenses: number;
  expense_total: number;
  expense_uncategorized: number;
}

interface Props {
  book: Book;
  bookLabel?: string;
  completeness: Completeness;
  uncategorized: TxnLite[];
  categories: { id: string; name: string }[];
}

interface MerchantGroup {
  merchant: string;
  count: number;
  total: number;
  sample_pfc: string | null;
  sample_date: string;
}

export function CategorizeView({
  book,
  bookLabel: bookLabelProp,
  completeness,
  uncategorized,
  categories,
}: Props) {
  const bookLabel = bookLabelProp ?? BOOK_LABELS[book];
  const router = useRouter();
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState<{
    total: number;
    processed: number;
    rule_applied: number;
    ai_applied: number;
    skipped: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runAiBackfill() {
    if (aiBusy) return;
    setAiBusy(true);
    setAiProgress(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/categorize/backfill", {
        method: "POST",
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error("Backfill failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as {
              type: string;
              total?: number;
              processed?: number;
              rule_applied?: number;
              ai_applied?: number;
              skipped?: number;
            };
            if (evt.type === "progress" || evt.type === "done" || evt.type === "start") {
              setAiProgress({
                total: evt.total ?? 0,
                processed: evt.processed ?? 0,
                rule_applied: evt.rule_applied ?? 0,
                ai_applied: evt.ai_applied ?? 0,
                skipped: evt.skipped ?? 0,
              });
            }
          } catch {
            /* ignore malformed line */
          }
        }
      }
      router.refresh();
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        console.error(err);
        alert("AI backfill failed");
      }
    } finally {
      setAiBusy(false);
    }
  }

  // Group by merchant. Blank-merchant rows are bucketed under description.
  const groups: MerchantGroup[] = useMemo(() => {
    const m = new Map<string, MerchantGroup>();
    for (const t of uncategorized) {
      const key = (t.merchant || t.description || "(no merchant)").trim();
      const g = m.get(key) ?? {
        merchant: key,
        count: 0,
        total: 0,
        sample_pfc: t.pfc_primary,
        sample_date: t.date,
      };
      g.count += 1;
      g.total += Number(t.amount);
      if (t.date > g.sample_date) g.sample_date = t.date;
      m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [uncategorized]);

  async function applyMerchant(merchant: string) {
    const categoryId = assignments[merchant];
    if (!categoryId) return;
    setBusy(merchant);
    try {
      const res = await fetch("/api/transactions/apply-merchant-rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          merchant,
          category_id: categoryId,
          scope: "uncategorized",
        }),
      });
      if (!res.ok) throw new Error("Apply failed");
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Apply failed");
    } finally {
      setBusy(null);
    }
  }

  const pct = completeness.pct_of_expenses;
  const pctColor =
    pct >= 95 ? "text-surplus" : pct >= 75 ? "text-warning" : "text-deficit";

  return (
    <div className="space-y-5 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-sm">{bookLabel}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Categorize transactions
          </h1>
          <p className="text-xs text-muted">
            Group by merchant, pick a category, apply once — the rule lives
            forever and back-fills every uncategorized transaction we already
            have.
          </p>
        </div>
        <button
          onClick={runAiBackfill}
          disabled={aiBusy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-hover disabled:opacity-60"
          title="Runs manual rules first, then Claude for leftovers. Updates Other-tagged txns too."
        >
          {aiBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          Auto-categorize uncategorized with AI
        </button>
      </header>

      {aiProgress && (
        <Card accent="terracotta">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <p className="label-sm">AI backfill</p>
              <p className="mt-0.5 num">
                {aiProgress.processed} / {aiProgress.total} processed
              </p>
            </div>
            <div className="flex gap-4 text-xs text-muted">
              <span>
                Rule:{" "}
                <span className="text-surplus num">{aiProgress.rule_applied}</span>
              </span>
              <span>
                AI:{" "}
                <span className="text-terracotta num">{aiProgress.ai_applied}</span>
              </span>
              <span>
                Skipped:{" "}
                <span className="text-muted num">{aiProgress.skipped}</span>
              </span>
            </div>
          </div>
          {aiProgress.total > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card-hover">
              <div
                className="h-full bg-terracotta transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (aiProgress.processed / aiProgress.total) * 100
                  )}%`,
                }}
              />
            </div>
          )}
        </Card>
      )}

      <ElevatedCard accent={pct >= 95 ? "surplus" : pct >= 75 ? "warning" : "deficit"}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-sm">Categorization completeness</p>
            <p className={`mt-1 hero-value ${pctColor}`}>{pct}%</p>
            <p className="mt-1 text-xs text-muted num">
              {completeness.expense_total - completeness.expense_uncategorized}
              {" / "}
              {completeness.expense_total} expenses categorized ·{" "}
              {completeness.expense_uncategorized} left
            </p>
          </div>
          {pct >= 95 && (
            <div className="flex items-center gap-2 text-sm text-surplus">
              <Sparkles className="h-5 w-5" />
              Ready for auto-budget
            </div>
          )}
        </div>
      </ElevatedCard>

      {groups.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <Check className="mx-auto mb-2 h-6 w-6 text-surplus" />
            <p className="font-medium">Nothing to categorize</p>
            <p className="mt-1 text-sm text-muted">
              Every expense transaction has a category. Head to Budgets to
              generate a budget from your history.
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-hidden rounded-xl border border-border-subtle">
            <table className="w-full text-sm">
              <thead className="border-b border-border-subtle bg-card-hover text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Merchant</th>
                  <th className="px-3 py-2 text-right"># txns</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Plaid PFC</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {groups.map((g) => (
                  <tr key={g.merchant} className="hover:bg-card-hover">
                    <td className="px-3 py-2 font-medium">{g.merchant}</td>
                    <td className="px-3 py-2 text-right num">{g.count}</td>
                    <td className="px-3 py-2 text-right num">
                      {formatCurrency(g.total)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {g.sample_pfc || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={assignments[g.merchant] ?? ""}
                        onChange={(e) =>
                          setAssignments((p) => ({
                            ...p,
                            [g.merchant]: e.target.value,
                          }))
                        }
                        className="rounded-lg border border-border-subtle bg-card px-2 py-1 text-xs"
                      >
                        <option value="">Choose…</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => applyMerchant(g.merchant)}
                        disabled={
                          !assignments[g.merchant] || busy === g.merchant
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                      >
                        {busy === g.merchant ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Apply
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-card-hover text-xs">
                <tr>
                  <td className="px-3 py-2 font-medium">
                    {groups.length} merchant{groups.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-3 py-2 text-right num">
                    {groups.reduce((s, g) => s + g.count, 0)}
                  </td>
                  <td className="px-3 py-2 text-right num font-semibold">
                    {formatCurrency(groups.reduce((s, g) => s + g.total, 0))}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {uncategorized.some((t) => t.pfc_primary?.startsWith("TRANSFER")) && (
        <p className="text-xs text-muted">
          Transfers and income don&rsquo;t appear here — they&rsquo;re intentionally
          left off the budget side.
        </p>
      )}
    </div>
  );
}
