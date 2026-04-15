"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import { CHART_COLORS } from "@/components/charts/palette";
import {
  projectPortfolio,
  formatYmdMonth,
  type DebtLike,
  type Strategy,
} from "@/lib/finance/amortization";

interface Props {
  debts: DebtLike[];
  monthlyExtra: number;
  strategy: Strategy;
}

/**
 * Stacked-area chart showing portfolio payoff over time per debt.
 * Two projections are overlaid:
 *   - Solid stacked areas: with the current monthly extra applied.
 *   - Dashed outline on top: minimum-payment-only baseline (no extras).
 * X-axis is "MMM YYYY" months, Y-axis is dollars. Tooltip shows each
 * debt's remaining balance plus the total.
 */
export function DebtPayoffStackedChart({ debts, monthlyExtra, strategy }: Props) {
  const { data, debtMeta, maxMonths } = useMemo(() => {
    if (debts.length === 0) {
      return { data: [], debtMeta: [] as Array<{ id: string; label: string; color: string }>, maxMonths: 0 };
    }

    const withExtra = projectPortfolio(debts, monthlyExtra, strategy);
    const minOnly = projectPortfolio(debts, 0, strategy);

    const meta = debts.map((d, i) => ({
      id: d.id,
      label: d.nickname || d.creditor,
      color: d.color || CHART_COLORS[i % CHART_COLORS.length],
    }));

    const maxLen = Math.max(withExtra.timeline.length, minOnly.timeline.length);

    const rows: Array<Record<string, number | string>> = [];
    for (let i = 0; i < maxLen; i++) {
      const we = withExtra.timeline[i];
      const mo = minOnly.timeline[i];
      const date = we?.date ?? mo?.date ?? "";
      const row: Record<string, number | string> = {
        month: i,
        label: date ? formatYmdMonth(date) : `${i}mo`,
      };
      let weTotal = 0;
      let moTotal = 0;
      for (const d of meta) {
        const weVal = we ? Math.max(0, we.byDebt[d.id] ?? 0) : 0;
        const moVal = mo ? Math.max(0, mo.byDebt[d.id] ?? 0) : 0;
        row[`we_${d.id}`] = weVal;
        row[`mo_${d.id}`] = moVal;
        weTotal += weVal;
        moTotal += moVal;
      }
      row.weTotal = weTotal;
      row.moTotal = moTotal;
      rows.push(row);
    }

    return { data: rows, debtMeta: meta, maxMonths: maxLen };
  }, [debts, monthlyExtra, strategy]);

  if (debts.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted">
        No debts to project — add an account to see payoff curves.
      </div>
    );
  }

  const labelById = new Map(debtMeta.map((d) => [d.id, d.label]));

  return (
    <div>
      <p className="label-sm mb-2">
        Payoff projection · {maxMonths} months · {strategy === "avalanche" ? "Avalanche" : "Snowball"}
        {monthlyExtra > 0 ? ` · +${formatCurrency(monthlyExtra)}/mo extra` : ""}
      </p>
      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              {debtMeta.map((d) => (
                <linearGradient key={d.id} id={`dp-${d.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={d.color} stopOpacity={0.75} />
                  <stop offset="100%" stopColor={d.color} stopOpacity={0.15} />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v, name) => {
                const raw = String(name);
                if (raw === "moTotal") {
                  return [formatCurrency(Number(v)), "Total (min only)"];
                }
                const id = raw.replace(/^we_/, "");
                return [formatCurrency(Number(v)), labelById.get(id) ?? raw];
              }}
              labelFormatter={(l) => String(l)}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {debtMeta.map((d) => (
              <Area
                key={`we_${d.id}`}
                type="monotone"
                stackId="with-extra"
                dataKey={`we_${d.id}`}
                name={d.label}
                stroke={d.color}
                strokeWidth={1.5}
                fill={`url(#dp-${d.id})`}
                isAnimationActive={false}
              />
            ))}
            {/* Minimum-only baseline as a dashed outline on top. */}
            <Area
              type="monotone"
              dataKey="moTotal"
              name="Total (min only)"
              stroke="var(--muted)"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              fill="transparent"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
