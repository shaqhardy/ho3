"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import { CHART_COLORS } from "@/components/charts/palette";

interface Txn {
  amount: number | string;
  merchant: string | null;
  description: string | null;
  is_income: boolean;
  split_parent_id?: string | null;
  id?: string;
  date: string;
}

type Window = "30" | "90" | "12";
const WINDOW_OPTS: { v: Window; label: string; days: number }[] = [
  { v: "30", label: "30d", days: 30 },
  { v: "90", label: "90d", days: 90 },
  { v: "12", label: "12mo", days: 365 },
];

export function TopMerchants({
  transactions,
  limit = 10,
  defaultWindow = "30",
}: {
  transactions: Txn[];
  limit?: number;
  defaultWindow?: Window;
}) {
  const [win, setWin] = useState<Window>(defaultWindow);
  const since = useMemo(() => {
    const d = new Date();
    const days = WINDOW_OPTS.find((o) => o.v === win)!.days;
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [win]);

  const rows = useMemo(() => {
    const childParents = new Set<string>();
    for (const t of transactions) {
      if (t.split_parent_id) childParents.add(t.split_parent_id);
    }
    const m = new Map<string, { merchant: string; total: number; count: number }>();
    for (const t of transactions) {
      if (t.is_income) continue;
      if (t.id && childParents.has(t.id)) continue;
      if (t.date < since) continue;
      const key = (t.merchant || t.description || "—").trim();
      const cur = m.get(key) ?? { merchant: key, total: 0, count: 0 };
      cur.total += Math.abs(Number(t.amount));
      cur.count += 1;
      m.set(key, cur);
    }
    return Array.from(m.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }, [transactions, since, limit]);

  if (rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted">
        No merchants in this window.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="label-sm">Top merchants</p>
        <div className="flex gap-1 text-xs">
          {WINDOW_OPTS.map((o) => (
            <button
              key={o.v}
              onClick={() => setWin(o.v)}
              className={`rounded border px-2 py-0.5 ${
                win === o.v
                  ? "border-terracotta bg-terracotta/10 text-terracotta"
                  : "border-border-subtle text-muted hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ width: "100%", height: Math.min(rows.length * 30 + 40, 380) }}>
        <ResponsiveContainer>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ left: 110, right: 20, top: 4, bottom: 4 }}
          >
            <XAxis
              type="number"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
            />
            <YAxis
              type="category"
              dataKey="merchant"
              tick={{ fontSize: 11 }}
              width={110}
            />
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
            <Bar dataKey="total" radius={[0, 4, 4, 0]}>
              {rows.map((_, i) => (
                <Cell
                  key={i}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
