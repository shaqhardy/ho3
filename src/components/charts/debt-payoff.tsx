"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import { CHART_COLORS } from "@/components/charts/palette";

interface DebtLite {
  id: string;
  creditor: string;
  nickname?: string | null;
  current_balance: number | string;
  apr: number | string;
  minimum_payment: number | string;
}

/** Simulate month-by-month balance under the current minimum payment. */
function payoffSeries(
  balance: number,
  apr: number,
  minPayment: number,
  maxMonths = 240
): number[] {
  if (balance <= 0 || minPayment <= 0) return [balance];
  const monthlyRate = apr / 100 / 12;
  const out: number[] = [balance];
  let rem = balance;
  for (let m = 0; m < maxMonths && rem > 0.01; m++) {
    const interest = rem * monthlyRate;
    const principal = Math.min(minPayment - interest, rem);
    if (principal <= 0) {
      // Min payment doesn't cover interest — stall, output the same balance
      // and bail after a few rounds rather than growing.
      out.push(rem);
      if (out.length > 24) break;
      continue;
    }
    rem -= principal;
    out.push(Math.max(rem, 0));
  }
  return out;
}

export function DebtPayoffChart({ debts }: { debts: DebtLite[] }) {
  const { data, maxMonths, labels } = useMemo(() => {
    const seriesByDebt = debts.map((d) =>
      payoffSeries(
        Number(d.current_balance),
        Number(d.apr),
        Number(d.minimum_payment)
      )
    );
    const max = Math.max(1, ...seriesByDebt.map((s) => s.length));
    const labs = debts.map((d) => d.nickname || d.creditor);
    const rows: Array<Record<string, number | string>> = [];
    for (let i = 0; i < max; i++) {
      const row: Record<string, number | string> = { month: i };
      for (let di = 0; di < debts.length; di++) {
        const s = seriesByDebt[di];
        row[labs[di]] = i < s.length ? s[i] : 0;
      }
      rows.push(row);
    }
    return { data: rows, maxMonths: max, labels: labs };
  }, [debts]);

  if (debts.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted">
        No debt accounts — connect a credit card or loan to see payoff curves.
      </div>
    );
  }

  return (
    <div>
      <p className="label-sm mb-2">
        Payoff curve · {maxMonths} months at minimum payment
      </p>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${v}mo`}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(v, n) => [
                formatCurrency(Number(v)) as unknown as string,
                String(n),
              ]}
              labelFormatter={(l) => `Month ${l}`}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {labels.map((l, i) => (
              <Line
                key={l}
                type="monotone"
                dataKey={l}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
