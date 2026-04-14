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
import type { Book } from "@/lib/types";
import { BOOK_BAND_COLORS } from "@/components/charts/palette";
import { BOOK_LABELS } from "@/lib/books";

interface AccountLite {
  id: string;
  book: Book;
  type: string;
  current_balance: number | string;
}

interface TxnLite {
  book: Book;
  date: string;
  amount: number | string;
  is_income: boolean;
  account_id: string | null;
  split_parent_id?: string | null;
  id: string;
}

interface Props {
  accounts: AccountLite[];
  transactions: TxnLite[];
  months?: number;
}

/**
 * Approximate end-of-month net worth per book by walking backwards from the
 * current balance and unwinding cash flows. For each account we take the
 * current balance and subtract subsequent income or add subsequent expenses
 * (depository logic) to arrive at a rough historical value. Not a perfect
 * reconstruction — institutions can adjust fees, interest, etc. — but close
 * enough for a trend line that shows where net worth is heading.
 */
export function NetWorthTrend({
  accounts,
  transactions,
  months = 12,
}: Props) {
  const data = useMemo(() => {
    const childParents = new Set<string>();
    for (const t of transactions) {
      if (t.split_parent_id) childParents.add(t.split_parent_id);
    }

    // Current net-worth per book (signed: assets +, liabilities -).
    const isLiability = (type: string) => type === "credit" || type === "loan";
    const currentByBook: Record<Book, number> = {
      personal: 0,
      business: 0,
      nonprofit: 0,
    };
    for (const a of accounts) {
      const bal = Number(a.current_balance);
      currentByBook[a.book] += isLiability(a.type) ? -bal : bal;
    }

    // Aggregate net cash flow per month per book from the transactions. For a
    // reverse walk, income = reduce balance going backward, expense = increase.
    type MonthKey = string; // YYYY-MM
    const axis: MonthKey[] = [];
    const today = new Date();
    const endOf = (y: number, m: number) =>
      new Date(y, m + 1, 0).toISOString().slice(0, 10);

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      axis.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }

    const netByMonthBook: Record<MonthKey, Record<Book, number>> = {};
    for (const key of axis) {
      netByMonthBook[key] = { personal: 0, business: 0, nonprofit: 0 };
    }
    for (const t of transactions) {
      if (t.id && childParents.has(t.id)) continue;
      const key = t.date.slice(0, 7);
      if (!netByMonthBook[key]) continue;
      const v = Math.abs(Number(t.amount));
      // For net worth: income raises it, expense lowers it (depository side).
      netByMonthBook[key][t.book] += t.is_income ? v : -v;
    }

    // Build series: for each axis month end, compute net worth at that point.
    // endOfMonth = current - sum(netFlows after this month)
    const series: Array<{ label: string; personal: number; business: number; nonprofit: number; total: number }> = [];
    const books: Book[] = ["personal", "business", "nonprofit"];

    // Running reverse accumulators per book.
    const runningFutureNet: Record<Book, number> = { personal: 0, business: 0, nonprofit: 0 };

    for (let i = axis.length - 1; i >= 0; i--) {
      const key = axis[i];
      const [yStr, mStr] = key.split("-");
      const y = Number(yStr);
      const m = Number(mStr) - 1;
      const dateLabel = new Date(y, m, 1).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      // End of this month's value = currentByBook - runningFutureNet.
      const row: { label: string; personal: number; business: number; nonprofit: number; total: number; endDate: string } = {
        label: dateLabel,
        personal: 0,
        business: 0,
        nonprofit: 0,
        total: 0,
        endDate: endOf(y, m),
      };
      for (const b of books) {
        const v = currentByBook[b] - runningFutureNet[b];
        row[b] = v;
      }
      row.total = row.personal + row.business + row.nonprofit;
      series.unshift(row);
      // After recording, add this month's flows to the reverse accumulator —
      // so the previous month is "before this month happened".
      for (const b of books) {
        runningFutureNet[b] += netByMonthBook[key][b];
      }
    }

    return series;
  }, [accounts, transactions, months]);

  return (
    <div>
      <p className="label-sm mb-2">Net worth · last {months} months</p>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              {(["personal", "business", "nonprofit"] as Book[]).map((b) => (
                <linearGradient key={b} id={`nw-${b}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BOOK_BAND_COLORS[b]} stopOpacity={0.7} />
                  <stop offset="100%" stopColor={BOOK_BAND_COLORS[b]} stopOpacity={0.1} />
                </linearGradient>
              ))}
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
            {(["personal", "business", "nonprofit"] as Book[]).map((b) => (
              <Area
                key={b}
                type="monotone"
                dataKey={b}
                stackId="1"
                name={BOOK_LABELS[b]}
                stroke={BOOK_BAND_COLORS[b]}
                fill={`url(#nw-${b})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
