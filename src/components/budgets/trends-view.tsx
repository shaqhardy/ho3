"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

interface BudgetLite {
  id: string;
  name: string;
  book: string;
  is_active: boolean;
  budget_categories: Array<{ category_id: string; allocated_amount: number }>;
}

interface TxnLite {
  date: string;
  amount: number | string;
  category_id: string | null;
  split_parent_id: string | null;
  is_income: boolean;
  book: string;
}

interface CatLite {
  id: string;
  name: string;
}

interface Props {
  months: 3 | 6 | 12;
  budgets: BudgetLite[];
  transactions: TxnLite[];
  categories: CatLite[];
}

const COLORS = [
  "#cc5500", // terracotta
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#ef4444",
  "#6366f1",
  "#84cc16",
];

export function BudgetTrendsView({
  months,
  budgets,
  transactions,
  categories,
}: Props) {
  // Aggregate allocated-per-category across all active budgets (typically one).
  const allocatedByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of budgets) {
      for (const bc of b.budget_categories ?? []) {
        m.set(bc.category_id, (m.get(bc.category_id) ?? 0) + Number(bc.allocated_amount));
      }
    }
    return m;
  }, [budgets]);

  const catName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  // Build month-axis: oldest → newest, including current month.
  const axis: string[] = useMemo(() => {
    const out: string[] = [];
    const today = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      out.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }
    return out;
  }, [months]);

  const data = useMemo(() => {
    // { month: "2026-01", [catName]: amount, ... }
    const childParents = new Set<string>();
    for (const t of transactions) {
      if (t.split_parent_id) childParents.add(t.split_parent_id as string);
    }
    const byMonthCat = new Map<string, Map<string, number>>();
    for (const t of transactions) {
      if (!t.category_id) continue;
      if ((t as unknown as { id: string }).id && childParents.has((t as unknown as { id: string }).id))
        continue;
      const key = t.date.slice(0, 7);
      const inner = byMonthCat.get(key) ?? new Map<string, number>();
      inner.set(t.category_id, (inner.get(t.category_id) ?? 0) + Math.abs(Number(t.amount)));
      byMonthCat.set(key, inner);
    }
    return axis.map((month) => {
      const row: Record<string, number | string> = { month };
      for (const cid of allocatedByCategory.keys()) {
        const name = catName.get(cid) ?? cid;
        row[name] = byMonthCat.get(month)?.get(cid) ?? 0;
      }
      return row;
    });
  }, [axis, transactions, allocatedByCategory, catName]);

  const categoryLines = useMemo(() => {
    const ids = Array.from(allocatedByCategory.keys());
    return ids
      .map((id) => ({
        id,
        name: catName.get(id) ?? id,
        allocated: allocatedByCategory.get(id) ?? 0,
      }))
      .sort((a, b) => b.allocated - a.allocated);
  }, [allocatedByCategory, catName]);

  // Summary: avg last 3 months vs allocated → growing / stable / shrinking / over / under.
  const summary = useMemo(() => {
    const last3 = data.slice(-3);
    const prior3 = data.slice(-6, -3);
    return categoryLines.map((cl) => {
      const recent =
        last3.reduce((s, r) => s + (Number(r[cl.name] ?? 0) || 0), 0) /
        Math.max(last3.length, 1);
      const prior =
        prior3.length > 0
          ? prior3.reduce((s, r) => s + (Number(r[cl.name] ?? 0) || 0), 0) /
            prior3.length
          : recent;
      let trend: "growing" | "shrinking" | "stable" = "stable";
      if (prior > 5 && recent - prior > prior * 0.15) trend = "growing";
      else if (prior > 5 && prior - recent > prior * 0.15) trend = "shrinking";
      const vsAllocated: "over" | "under" | "on_target" =
        cl.allocated === 0
          ? "on_target"
          : recent > cl.allocated * 1.1
            ? "over"
            : recent < cl.allocated * 0.7
              ? "under"
              : "on_target";
      return { ...cl, recentAvg: recent, priorAvg: prior, trend, vsAllocated };
    });
  }, [data, categoryLines]);

  return (
    <div className="space-y-5 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-sm">Personal · Budgets</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Trends</h1>
          <p className="text-xs text-muted">
            Actual spend per category over the last {months} months. Dashed line
            = current budget allocation.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {[3, 6, 12].map((m) => (
            <Link
              key={m}
              href={`/personal/budgets/trends?months=${m}`}
              className={`rounded-lg border px-3 py-1 ${
                m === months
                  ? "border-terracotta bg-terracotta/10 text-terracotta"
                  : "border-border-subtle text-muted hover:text-foreground"
              }`}
            >
              {m}mo
            </Link>
          ))}
        </div>
      </header>

      {categoryLines.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-muted">
            No active budgets — generate one first to see trends.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <LineChart data={data}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    formatter={(v) => formatCurrency(Number(v)) as unknown as string}
                    labelFormatter={(l) => String(l)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {categoryLines.map((cl, i) => (
                    <Line
                      key={cl.id}
                      type="monotone"
                      dataKey={cl.name}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  ))}
                  {categoryLines.map((cl, i) =>
                    cl.allocated > 0 ? (
                      <ReferenceLine
                        key={`ref-${cl.id}`}
                        y={cl.allocated}
                        stroke={COLORS[i % COLORS.length]}
                        strokeDasharray="3 3"
                        strokeOpacity={0.5}
                      />
                    ) : null
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 label-sm">Summary</h2>
            <ul className="divide-y divide-border-subtle">
              {summary.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted num">
                      avg {formatCurrency(s.recentAvg)} / mo last 3 · budget{" "}
                      {formatCurrency(s.allocated)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Pill
                      tone={
                        s.trend === "growing"
                          ? "warning"
                          : s.trend === "shrinking"
                            ? "surplus"
                            : "muted"
                      }
                    >
                      {s.trend}
                    </Pill>
                    <Pill
                      tone={
                        s.vsAllocated === "over"
                          ? "deficit"
                          : s.vsAllocated === "under"
                            ? "surplus"
                            : "muted"
                      }
                    >
                      {s.vsAllocated === "over"
                        ? "over budget"
                        : s.vsAllocated === "under"
                          ? "under budget"
                          : "on target"}
                    </Pill>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "deficit" | "warning" | "surplus" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "deficit"
      ? "bg-deficit/10 text-deficit"
      : tone === "warning"
        ? "bg-warning/10 text-warning"
        : tone === "surplus"
          ? "bg-surplus/10 text-surplus"
          : "bg-card-hover text-muted";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}
