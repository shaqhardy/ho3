"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Plus } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { BOOK_BAND_COLORS } from "@/components/charts/palette";
import { BOOK_LABELS } from "@/lib/books";
import type { Book, IncomeEntry } from "@/lib/types";
import {
  AddIncomeDialog,
  type IncomeDialogAccount,
  type IncomeDialogDefaults,
} from "@/components/income/add-income-dialog";

interface Props {
  entries: IncomeEntry[];
  accounts: IncomeDialogAccount[];
  availableBooks: Book[];
  title?: string;
  addIncomeDefaults?: IncomeDialogDefaults;
  // When set, the section is scoped to a single book/account — the chart
  // renders a single series instead of the three-book breakdown.
  scopedBook?: Book | null;
}

export function IncomeSection({
  entries,
  accounts,
  availableBooks,
  title = "Income",
  addIncomeDefaults,
  scopedBook = null,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);

  const { mtd, qtd, ytd, perBookTotals, chart } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const quarterStartMonth = Math.floor(month / 3) * 3;
    const qtdStart = new Date(year, quarterStartMonth, 1);
    const ytdStart = new Date(year, 0, 1);
    const mtdStart = new Date(year, month, 1);

    let mtd = 0;
    let qtd = 0;
    let ytd = 0;
    const perBookTotals: Record<Book, { mtd: number; qtd: number; ytd: number }> = {
      personal: { mtd: 0, qtd: 0, ytd: 0 },
      business: { mtd: 0, qtd: 0, ytd: 0 },
      nonprofit: { mtd: 0, qtd: 0, ytd: 0 },
    };

    // 12-month axis (oldest → newest), inclusive of current month.
    const monthKeys: string[] = [];
    const monthLabels: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      monthKeys.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
      monthLabels.push(
        d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
      );
    }
    const chartData = monthKeys.map((k, i) => ({
      key: k,
      label: monthLabels[i],
      personal: 0,
      business: 0,
      nonprofit: 0,
      total: 0,
    }));
    const chartIdx = new Map(monthKeys.map((k, i) => [k, i]));

    for (const e of entries) {
      if (!e.is_confirmed) continue;
      const dateStr = e.received_date;
      if (!dateStr) continue;
      const amt = Number(e.amount);
      if (!Number.isFinite(amt) || amt <= 0) continue;

      const d = new Date(dateStr + "T00:00:00");
      if (d >= ytdStart) ytd += amt;
      if (d >= qtdStart) qtd += amt;
      if (d >= mtdStart) mtd += amt;

      const b = e.book as Book;
      if (b in perBookTotals) {
        if (d >= ytdStart) perBookTotals[b].ytd += amt;
        if (d >= qtdStart) perBookTotals[b].qtd += amt;
        if (d >= mtdStart) perBookTotals[b].mtd += amt;
      }

      const key = dateStr.slice(0, 7);
      const idx = chartIdx.get(key);
      if (idx !== undefined) {
        chartData[idx][b] += amt;
        chartData[idx].total += amt;
      }
    }

    return { mtd, qtd, ytd, perBookTotals, chart: chartData };
  }, [entries]);

  const maxChartValue = chart.reduce((m, d) => Math.max(m, d.total), 0);
  const empty = entries.filter((e) => e.is_confirmed).length === 0;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label-sm">{title}</h2>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-2.5 py-1 text-xs font-medium text-white"
        >
          <Plus className="h-3 w-3" /> Add Income
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Month to Date"
          value={formatCurrency(mtd)}
          accent="green"
          color="text-surplus"
        />
        <StatCard
          label="Quarter to Date"
          value={formatCurrency(qtd)}
          subtext="Use this for estimated tax payments."
          accent="blue"
          color="text-surplus"
        />
        <StatCard
          label="Year to Date"
          value={formatCurrency(ytd)}
          subtext="1099 / tax-year total."
          accent="terracotta"
          color="text-surplus"
        />
      </div>

      <Card className="mt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="label-sm">
            Income · last 12 months
            {scopedBook ? ` · ${BOOK_LABELS[scopedBook]}` : " · by book"}
          </p>
          <span className="text-xs text-muted num">
            {maxChartValue > 0 ? `Peak ${formatCurrency(maxChartValue)}` : ""}
          </span>
        </div>
        {empty ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted">
            No confirmed income yet. Hit &ldquo;+ Add Income&rdquo; or confirm
            a Plaid credit below.
          </div>
        ) : (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={chart}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    `$${(Number(v) / 1000).toFixed(Number(v) >= 10000 ? 0 : 1)}k`
                  }
                />
                <Tooltip
                  formatter={(v, name) => [
                    formatCurrency(Number(v)) as unknown as string,
                    String(name),
                  ]}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                {!scopedBook && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {scopedBook ? (
                  <Bar
                    dataKey={scopedBook}
                    name={BOOK_LABELS[scopedBook]}
                    fill={BOOK_BAND_COLORS[scopedBook]}
                    radius={[4, 4, 0, 0]}
                  />
                ) : (
                  (["personal", "business", "nonprofit"] as Book[]).map((b) => (
                    <Bar
                      key={b}
                      dataKey={b}
                      name={BOOK_LABELS[b]}
                      stackId="income"
                      fill={BOOK_BAND_COLORS[b]}
                    />
                  ))
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {!scopedBook && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            {(["personal", "business", "nonprofit"] as Book[]).map((b) => (
              <div
                key={b}
                className="rounded-lg border border-border-subtle p-2"
              >
                <p className="flex items-center gap-1.5 text-muted">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ background: BOOK_BAND_COLORS[b] }}
                  />
                  {BOOK_LABELS[b]}
                </p>
                <p className="mt-1 num font-semibold text-foreground">
                  {formatCurrency(perBookTotals[b].ytd)}
                </p>
                <p className="text-[10px] text-muted">YTD</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <AddIncomeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        accounts={accounts}
        availableBooks={availableBooks}
        defaults={addIncomeDefaults}
      />
    </section>
  );
}
