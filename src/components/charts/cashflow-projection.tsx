"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { formatCurrency } from "@/lib/format";

interface DailyPoint {
  date: string;
  label: string;
  balance: number;
  net: number;
}

export function CashflowProjectionChart({
  points,
}: {
  points: DailyPoint[];
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted">
        Nothing to project.
      </div>
    );
  }
  const shortfall = points.find((p) => p.balance < 0);
  return (
    <div>
      <p className="label-sm mb-2">Daily projected cash · next 30 days</p>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={points}>
            <defs>
              <linearGradient id="cf-pos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(1)}k`}
            />
            <Tooltip
              formatter={(v) => formatCurrency(Number(v)) as unknown as string}
              labelFormatter={(l) => String(l)}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" />
            {shortfall && (
              <ReferenceLine
                x={shortfall.label}
                stroke="#ef4444"
                label={{ value: "shortfall", fontSize: 10, fill: "#ef4444" }}
              />
            )}
            <Area
              type="monotone"
              dataKey="balance"
              stroke="#cc5500"
              fill="url(#cf-pos)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
