"use client";

import { useEffect, useMemo, useState } from "react";
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

type Window = "3mo" | "6mo" | "9mo" | "12mo" | "ytd";

const WINDOW_OPTS: { v: Window; label: string }[] = [
  { v: "3mo", label: "3 Months" },
  { v: "6mo", label: "6 Months" },
  { v: "9mo", label: "9 Months" },
  { v: "12mo", label: "12 Months" },
  { v: "ytd", label: "YTD" },
];

const STORAGE_KEY = "ho3.incomeVsExpensesWindow";

interface Props {
  transactions: Txn[];
}

function loadWindow(defaultWin: Window): Window {
  if (typeof window === "undefined") return defaultWin;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const match = WINDOW_OPTS.find((o) => o.v === raw);
    return match?.v ?? defaultWin;
  } catch {
    return defaultWin;
  }
}

function saveWindow(w: Window) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, w);
  } catch {
    /* incognito / quota — skip */
  }
}

/**
 * Count the number of calendar months to display for a given window. 3 Months
 * maps to 3 buckets, 12 Months to 12, YTD to however many months have
 * elapsed in the current year (inclusive of the current month).
 */
function monthsForWindow(w: Window, today: Date): number {
  switch (w) {
    case "3mo":
      return 3;
    case "6mo":
      return 6;
    case "9mo":
      return 9;
    case "12mo":
      return 12;
    case "ytd":
      return today.getMonth() + 1;
  }
}

/**
 * Last N calendar months of income vs expenses. Area = income; line below =
 * expenses. Month buckets regardless of window length — spec-required.
 */
export function IncomeVsExpenses({ transactions }: Props) {
  // Hydrate from localStorage after mount so SSR/CSR markup stays identical
  // on first paint, then catches up to the user's saved preference.
  const [win, setWin] = useState<Window>("12mo");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWin(loadWindow("12mo"));
  }, []);

  const months = useMemo(
    () => monthsForWindow(win, new Date()),
    [win]
  );

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

  const windowLabel =
    WINDOW_OPTS.find((o) => o.v === win)?.label ?? "12 Months";
  const empty = data.every((d) => d.income === 0 && d.expense === 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="label-sm">Income vs expenses · {windowLabel}</p>
        <WindowPicker
          value={win}
          onChange={(next) => {
            setWin(next);
            saveWindow(next);
          }}
        />
      </div>
      {empty ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted">
          No income or expenses in this window.
        </div>
      ) : (
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
      )}
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
    <div className="flex flex-wrap gap-1 text-xs">
      {WINDOW_OPTS.map((o) => (
        <button
          key={o.v}
          type="button"
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
