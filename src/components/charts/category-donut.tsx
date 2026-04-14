"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import { CHART_COLORS } from "@/components/charts/palette";

interface Txn {
  amount: number | string;
  category_id: string | null;
  is_income: boolean;
  split_parent_id?: string | null;
  id?: string;
  date: string;
  categories?: { name: string } | null;
}

type Window = "7" | "30" | "90" | "ytd" | "12";
const WINDOW_OPTS: { v: Window; label: string; days?: number }[] = [
  { v: "7", label: "7d", days: 7 },
  { v: "30", label: "30d", days: 30 },
  { v: "90", label: "90d", days: 90 },
  { v: "12", label: "12mo", days: 365 },
  { v: "ytd", label: "YTD" },
];

interface Props {
  transactions: Txn[];
  drilldownHrefFor?: (categoryName: string) => string | null;
  defaultWindow?: Window;
}

export function CategoryDonut({
  transactions,
  drilldownHrefFor,
  defaultWindow = "30",
}: Props) {
  const [win, setWin] = useState<Window>(defaultWindow);

  const since = useMemo(() => {
    const now = new Date();
    if (win === "ytd") {
      return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    }
    const opt = WINDOW_OPTS.find((o) => o.v === win);
    const d = new Date();
    d.setDate(d.getDate() - (opt?.days ?? 30));
    return d.toISOString().slice(0, 10);
  }, [win]);

  const data = useMemo(() => {
    const childParents = new Set<string>();
    for (const t of transactions) {
      if (t.split_parent_id) childParents.add(t.split_parent_id);
    }
    const m = new Map<string, number>();
    let total = 0;
    for (const t of transactions) {
      if (t.is_income) continue;
      if (t.id && childParents.has(t.id)) continue;
      if (t.date < since) continue;
      const name = t.categories?.name || "Uncategorized";
      const amt = Math.abs(Number(t.amount));
      m.set(name, (m.get(name) ?? 0) + amt);
      total += amt;
    }
    const sorted = Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return { rows: sorted, total };
  }, [transactions, since]);

  if (data.rows.length === 0) {
    return (
      <div className="flex h-60 items-center justify-center text-sm text-muted">
        No spending in this window.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="label-sm">Spending by category</p>
        <WindowPicker value={win} onChange={setWin} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
        <div className="relative h-56 w-full">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data.rows}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={88}
                paddingAngle={1}
                strokeWidth={0}
              >
                {data.rows.map((_, i) => (
                  <Cell
                    key={i}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) =>
                  formatCurrency(Number(v)) as unknown as string
                }
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs text-muted">Total</span>
            <span className="num text-lg font-semibold">
              {formatCurrency(data.total)}
            </span>
          </div>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {data.rows.slice(0, 8).map((r, i) => {
            const pct = (r.value / data.total) * 100;
            const color = CHART_COLORS[i % CHART_COLORS.length];
            const href = drilldownHrefFor ? drilldownHrefFor(r.name) : null;
            const row = (
              <span className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-card-hover">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="num text-xs text-muted">
                  {formatCurrency(r.value)} · {pct.toFixed(0)}%
                </span>
              </span>
            );
            return (
              <li key={r.name}>
                {href ? <Link href={href}>{row}</Link> : row}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function WindowPicker({
  value,
  onChange,
}: {
  value: Window;
  onChange: (v: Window) => void;
}) {
  return (
    <div className="flex gap-1 text-xs">
      {WINDOW_OPTS.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`rounded border px-2 py-0.5 ${
            value === o.v
              ? "border-terracotta bg-terracotta/10 text-terracotta"
              : "border-border-subtle text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
