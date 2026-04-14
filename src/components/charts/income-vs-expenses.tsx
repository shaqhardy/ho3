"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatCurrency } from "@/lib/format";

interface Txn {
  amount: number | string;
  is_income: boolean;
  split_parent_id?: string | null;
  id?: string;
  date: string;
}

interface Props {
  transactions: Txn[];
  months?: number;
}

/**
 * Last N months of income vs expenses. The background area = income; the line
 * below = expenses. Gap is implicitly surplus (green) or deficit (red) based
 * on whether expenses crossed income that month — shown in the tooltip.
 */
export function IncomeVsExpenses({ transactions, months = 6 }: Props) {
  const data = useMemo(() => {
    const axis: { key: string; label: string }[] = [];
    const today = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      axis.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-US", { month: "short" }),
      });
    }
    const childParents = new Set<string>();
    for (const t of transactions) {
      if (t.split_parent_id) childParents.add(t.split_parent_id);
    }
    const totals = new Map<string, { income: number; expense: number }>();
    for (const a of axis) totals.set(a.key, { income: 0, expense: 0 });
    for (const t of transactions) {
      if (t.id && childParents.has(t.id)) continue;
      const key = t.date.slice(0, 7);
      const bucket = totals.get(key);
      if (!bucket) continue;
      const v = Math.abs(Number(t.amount));
      if (t.is_income) bucket.income += v;
      else bucket.expense += v;
    }
    return axis.map((a) => {
      const b = totals.get(a.key) ?? { income: 0, expense: 0 };
      return {
        label: a.label,
        income: b.income,
        expense: b.expense,
        net: b.income - b.expense,
      };
    });
  }, [transactions, months]);

  if (data.every((d) => d.income === 0 && d.expense === 0)) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted">
        No income or expenses in the last {months} months.
      </div>
    );
  }

  return (
    <div>
      <p className="label-sm mb-2">Income vs expenses · last {months} months</p>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={data}>
            <defs>
              <linearGradient id="income-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(v, n) => [
                formatCurrency(Number(v)) as unknown as string,
                String(n),
              ]}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              name="Income"
              type="monotone"
              dataKey="income"
              stroke="#10b981"
              fill="url(#income-fill)"
              strokeWidth={2}
            />
            <Line
              name="Expenses"
              type="monotone"
              dataKey="expense"
              stroke="#cc5500"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
