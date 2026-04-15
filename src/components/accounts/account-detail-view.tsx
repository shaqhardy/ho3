"use client";

import {
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  CreditCard,
  Loader2,
  Pencil,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, ElevatedCard, StatCard } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { isLiability } from "@/lib/accounts/money";
import { BOOK_LABELS } from "@/lib/books";
import {
  amortize,
  amortizeWithExtra,
  formatMonthsHuman,
  formatYmdMonth,
  type ExtraPayment,
} from "@/lib/finance/amortization";
import type { Book } from "@/lib/types";
import type {
  DebtRecord,
  SnapshotRecord,
  StatementRecord,
  TransactionRecord,
} from "@/components/accounts/account-detail-types";

// Statements tab is built by a sibling feature. If that component isn't live
// yet in this build we silently fall back to the shim below so the route
// still compiles and renders a useful placeholder.
import ExternalStatementsTab from "@/components/accounts/statements-tab";
import type { AccountStatement } from "@/lib/types";

type TabId = "overview" | "transactions" | "statements" | "insights";

interface AccountSummary {
  id: string;
  book: Book;
  name: string;
  nickname: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: number;
  available_balance: number | null;
  last_synced_at: string | null;
  institution_name: string | null;
}

interface Props {
  account: AccountSummary;
  transactions: TransactionRecord[];
  debt: DebtRecord | null;
  statements: StatementRecord[];
  snapshots: SnapshotRecord[];
}

// ---------- helpers ----------------------------------------------------------

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function monthKey(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function toNum(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---------- component --------------------------------------------------------

export function AccountDetailView({
  account,
  transactions,
  debt,
  statements,
  snapshots,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");
  const liability = isLiability(account.type);
  const displayName = account.nickname || account.name;

  const showStatementsTab = statements.length > 0 || liability;
  const showInsights =
    account.type === "depository" || account.subtype === "checking" || account.subtype === "savings";

  // Drop split parents from any transaction aggregation — their kids carry the
  // real values. Ignoring them prevents double-counting in charts.
  const splitChildren = useMemo(() => {
    const s = new Set<string>();
    for (const t of transactions) if (t.split_parent_id) s.add(t.split_parent_id);
    return s;
  }, [transactions]);

  const effectiveTxns = useMemo(
    () => transactions.filter((t) => !splitChildren.has(t.id)),
    [transactions, splitChildren]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Link
          href="/accounts"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All accounts
        </Link>
      </div>

      <HeaderCard
        account={account}
        displayName={displayName}
        onRenamed={() => router.refresh()}
      />

      <Tabs
        tab={tab}
        onChange={setTab}
        showStatements={showStatementsTab}
        showInsights={showInsights}
      />

      {tab === "overview" && (
        <OverviewTab
          account={account}
          transactions={effectiveTxns}
          snapshots={snapshots}
          debt={debt}
          liability={liability}
        />
      )}
      {tab === "transactions" && (
        <TransactionsTab transactions={effectiveTxns} />
      )}
      {tab === "statements" && showStatementsTab && (
        <StatementsShim accountId={account.id} statements={statements} />
      )}
      {tab === "insights" && showInsights && (
        <InsightsTab
          account={account}
          transactions={effectiveTxns}
          snapshots={snapshots}
          debt={debt}
        />
      )}
    </div>
  );
}

// ---------- header -----------------------------------------------------------

function HeaderCard({
  account,
  displayName,
  onRenamed,
}: {
  account: AccountSummary;
  displayName: string;
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(account.nickname ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/accounts/${account.id}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: value }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Failed to save");
      }
      setEditing(false);
      onRenamed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ElevatedCard accent="terracotta">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="label-sm text-muted">
            {account.institution_name || "Manual account"} · {BOOK_LABELS[account.book]}
          </p>
          {editing ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={account.name}
                className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-lg"
                maxLength={100}
              />
              <button
                onClick={save}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setValue(account.nickname ?? "");
                  setErr(null);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold">{displayName}</h1>
              <button
                onClick={() => setEditing(true)}
                aria-label="Rename"
                className="text-muted hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}
          {err && <p className="mt-1 text-xs text-deficit">{err}</p>}
          <p className="mt-1 text-sm text-muted">
            {account.type}
            {account.subtype ? ` · ${account.subtype}` : ""}
            {account.mask ? ` · ••${account.mask}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Last synced {formatRelativeTime(account.last_synced_at)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:w-auto sm:min-w-[320px]">
          <div>
            <p className="label-sm">Current balance</p>
            <p
              className={`display-value num mt-1 ${
                isLiability(account.type) ? "text-deficit" : "text-foreground"
              }`}
            >
              {formatCurrency(account.current_balance)}
            </p>
          </div>
          <div>
            <p className="label-sm">Available</p>
            <p className="display-value num mt-1 text-foreground">
              {account.available_balance !== null
                ? formatCurrency(account.available_balance)
                : "—"}
            </p>
          </div>
        </div>
      </div>
    </ElevatedCard>
  );
}

// ---------- tabs -------------------------------------------------------------

function Tabs({
  tab,
  onChange,
  showStatements,
  showInsights,
}: {
  tab: TabId;
  onChange: (t: TabId) => void;
  showStatements: boolean;
  showInsights: boolean;
}) {
  const items: Array<{ id: TabId; label: string; visible: boolean }> = [
    { id: "overview", label: "Overview", visible: true },
    { id: "transactions", label: "Transactions", visible: true },
    { id: "statements", label: "Statements", visible: showStatements },
    { id: "insights", label: "Insights", visible: showInsights },
  ];
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
      {items
        .filter((i) => i.visible)
        .map((i) => (
          <button
            key={i.id}
            role="tab"
            aria-selected={tab === i.id}
            onClick={() => onChange(i.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === i.id
                ? "border-terracotta text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {i.label}
          </button>
        ))}
    </div>
  );
}

// ---------- overview tab -----------------------------------------------------

function OverviewTab({
  account,
  transactions,
  snapshots,
  debt,
  liability,
}: {
  account: AccountSummary;
  transactions: TransactionRecord[];
  snapshots: SnapshotRecord[];
  debt: DebtRecord | null;
  liability: boolean;
}) {
  const trend = useBalanceTrend(account, transactions, snapshots, liability);
  const monthlySpend = useMonthlySpend(transactions);

  return (
    <div className="space-y-6">
      <Card>
        <p className="label-sm mb-2">
          Balance trend · last 12 months
          {liability && <span className="ml-2 text-muted">(owed)</span>}
        </p>
        {trend.length <= 1 ? (
          <EmptyChart label="Not enough history yet" />
        ) : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="balTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#cc5500" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#cc5500" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v) => [formatCurrency(Number(v)), "Balance"]}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#cc5500"
                  fill="url(#balTrend)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {!liability && monthlySpend.length > 0 && (
        <Card>
          <p className="label-sm mb-2">Monthly spending · last 6 months</p>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={monthlySpend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v) => [formatCurrency(Number(v)), "Spent"]}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" fill="#cc5500" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {debt && <DebtPanel debt={debt} transactions={transactions} />}
    </div>
  );
}

function useBalanceTrend(
  account: AccountSummary,
  transactions: TransactionRecord[],
  snapshots: SnapshotRecord[],
  liability: boolean
): Array<{ label: string; value: number; date: string }> {
  return useMemo(() => {
    // Preferred path: at least 2 real snapshots — just bucket per month, taking
    // the latest snapshot within each month.
    if (snapshots.length >= 2) {
      const byMonth = new Map<string, SnapshotRecord>();
      for (const s of snapshots) {
        const k = s.snapshot_date.slice(0, 7);
        const cur = byMonth.get(k);
        if (!cur || s.snapshot_date > cur.snapshot_date) byMonth.set(k, s);
      }
      const rows = Array.from(byMonth.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, s]) => {
          const [y, m] = k.split("-").map(Number);
          const label = new Date(y, m - 1, 1).toLocaleDateString("en-US", {
            month: "short",
            year: "2-digit",
          });
          const bal = toNum(s.current_balance);
          return { label, value: liability ? Math.abs(bal) : bal, date: s.snapshot_date };
        });
      return rows;
    }

    // Fallback: walk backwards through transactions from current balance.
    // For asset accounts an income raises balance (so going back = subtract),
    // expense lowers it (going back = add). Flip for liabilities, where
    // purchases increase the owed balance.
    const today = new Date();
    const months: Array<{ label: string; date: string; endKey: string }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      months.push({
        label: d.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        date: endOfMonth.toISOString().slice(0, 10),
        endKey: monthKey(d),
      });
    }

    const txnsByMonth = new Map<string, number>(); // signed delta to current balance, positive = raises balance
    for (const t of transactions) {
      const k = t.date.slice(0, 7);
      const amt = Math.abs(toNum(t.amount));
      // For an asset account, incoming = +amt, expense = -amt.
      // For a liability, charges raise the balance (expense => +amt), payments lower (is_income => -amt).
      const delta = liability
        ? t.is_income
          ? -amt
          : amt
        : t.is_income
          ? amt
          : -amt;
      txnsByMonth.set(k, (txnsByMonth.get(k) ?? 0) + delta);
    }

    const current = liability
      ? Math.abs(account.current_balance)
      : account.current_balance;
    // Walk backwards: balance at the end of month i = current - sum of deltas after month i.
    let runningFuture = 0;
    const rows: Array<{ label: string; value: number; date: string }> = [];
    for (let i = months.length - 1; i >= 0; i--) {
      const m = months[i];
      rows.unshift({
        label: m.label,
        date: m.date,
        value: current - runningFuture,
      });
      runningFuture += txnsByMonth.get(m.endKey) ?? 0;
    }
    return rows;
  }, [account, transactions, snapshots, liability]);
}

function useMonthlySpend(
  transactions: TransactionRecord[]
): Array<{ label: string; value: number }> {
  return useMemo(() => {
    const today = new Date();
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      keys.push(monthKey(d));
    }
    const by = new Map<string, number>();
    for (const k of keys) by.set(k, 0);
    for (const t of transactions) {
      if (t.is_income) continue;
      const k = t.date.slice(0, 7);
      if (!by.has(k)) continue;
      by.set(k, (by.get(k) ?? 0) + Math.abs(toNum(t.amount)));
    }
    return keys.map((k) => {
      const [y, m] = k.split("-").map(Number);
      return {
        label: new Date(y, m - 1, 1).toLocaleDateString("en-US", {
          month: "short",
        }),
        value: by.get(k) ?? 0,
      };
    });
  }, [transactions]);
}

// ---------- debt panel (only for liability accounts with a debts row) --------

function DebtPanel({
  debt,
  transactions,
}: {
  debt: DebtRecord;
  transactions: TransactionRecord[];
}) {
  const bal = toNum(debt.current_balance);
  const apr = toNum(debt.apr);
  const min = toNum(debt.minimum_payment);
  const original = toNum(debt.original_balance ?? null);

  const minProjection = useMemo(() => amortize(bal, apr, min), [bal, apr, min]);

  const [extraAmount, setExtraAmount] = useState<number>(0);
  const [freq, setFreq] = useState<ExtraPayment["frequency"]>("monthly");

  const extraProjection = useMemo(
    () =>
      amortizeWithExtra(
        bal,
        apr,
        min,
        { amount: extraAmount, frequency: freq }
      ),
    [bal, apr, min, extraAmount, freq]
  );

  const monthsSaved = Math.max(0, minProjection.months - extraProjection.months);
  const interestSaved = Math.max(
    0,
    minProjection.totalInterest - extraProjection.totalInterest
  );

  const progressPct =
    original > 0 ? Math.min(100, Math.max(0, ((original - bal) / original) * 100)) : 0;

  // "Payments to this debt" = income-flagged transactions on this account
  // (credits to a credit-card account are paydowns) plus anything matching
  // "payment" in the merchant.
  const paymentHistory = useMemo(() => {
    return transactions
      .filter((t) => {
        if (t.is_income) return true;
        const m = (t.merchant || t.description || "").toLowerCase();
        return m.includes("payment") || m.includes("paid");
      })
      .slice(0, 10);
  }, [transactions]);

  return (
    <div className="space-y-6">
      <Card accent="terracotta">
        <div className="mb-3 flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-terracotta" />
          <h2 className="heading-sm">Debt details</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatLine label="Current balance" value={formatCurrency(bal)} />
          <StatLine label="APR" value={`${apr.toFixed(2)}%`} />
          <StatLine label="Min payment" value={formatCurrency(min)} />
          <StatLine
            label="Next due"
            value={
              debt.statement_due_date
                ? formatDate(debt.statement_due_date)
                : "—"
            }
          />
          <StatLine
            label="Original"
            value={original > 0 ? formatCurrency(original) : "—"}
          />
        </div>
        {original > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-muted">
              <span>{progressPct.toFixed(1)}% paid down</span>
              <span>
                {formatCurrency(original - bal)} of {formatCurrency(original)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-card-hover">
              <div
                className="h-full bg-surplus"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <p className="label-sm mb-2">Minimum-only payoff</p>
          <p className="display-value num text-foreground">
            {formatMonthsHuman(minProjection.months)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Paid off {formatYmdMonth(minProjection.payoffDate)}
          </p>
          <div className="mt-3 space-y-1 text-sm">
            <Row label="Total interest" value={formatCurrency(minProjection.totalInterest)} />
            <Row label="Total paid" value={formatCurrency(minProjection.totalPaid)} />
          </div>
        </Card>

        <Card accent="green">
          <p className="label-sm mb-2">With extra payment</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col">
              <span className="label-sm">Extra $</span>
              <input
                type="number"
                min={0}
                step={25}
                value={extraAmount}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setExtraAmount(Math.max(0, Number(e.target.value) || 0))
                }
                className="w-24 rounded-md border border-border bg-bg px-2 py-1"
              />
            </label>
            <label className="flex flex-col">
              <span className="label-sm">Frequency</span>
              <select
                value={freq}
                onChange={(e) =>
                  setFreq(e.target.value as ExtraPayment["frequency"])
                }
                className="rounded-md border border-border bg-bg px-2 py-1"
              >
                <option value="monthly">Monthly</option>
                <option value="biweekly">Biweekly</option>
                <option value="lump">One-time lump</option>
              </select>
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="label-sm">New payoff</p>
              <p className="num mt-0.5 font-semibold">
                {formatMonthsHuman(extraProjection.months)}
              </p>
            </div>
            <div>
              <p className="label-sm">Months saved</p>
              <p className="num mt-0.5 font-semibold text-surplus">
                {formatMonthsHuman(monthsSaved)}
              </p>
            </div>
            <div>
              <p className="label-sm">Interest saved</p>
              <p className="num mt-0.5 font-semibold text-surplus">
                {formatCurrency(interestSaved)}
              </p>
            </div>
            <div>
              <p className="label-sm">Total paid</p>
              <p className="num mt-0.5 font-semibold">
                {formatCurrency(extraProjection.totalPaid)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <p className="label-sm mb-2">Payment history</p>
        {paymentHistory.length === 0 ? (
          <p className="text-sm text-muted">No payments detected yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {paymentHistory.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-muted">{formatDate(t.date)}</span>
                  <span className="truncate">
                    {t.merchant || t.description || "—"}
                  </span>
                </div>
                <span className="num font-medium text-surplus">
                  {formatCurrency(Math.abs(toNum(t.amount)))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- transactions tab -------------------------------------------------

function TransactionsTab({ transactions }: { transactions: TransactionRecord[] }) {
  const [month, setMonth] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [catsOpen, setCatsOpen] = useState(false);

  const monthOptions = useMemo(() => {
    const s = new Set<string>();
    for (const t of transactions) s.add(t.date.slice(0, 7));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  const categoryOptions = useMemo(() => {
    const map = new Map<string, { name: string; color: string | null }>();
    for (const t of transactions) {
      const name = t.categories?.name;
      if (!name) continue;
      if (!map.has(name))
        map.set(name, {
          name,
          color: t.categories?.color ?? null,
        });
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [transactions]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (month !== "all" && !t.date.startsWith(month)) return false;
      if (cats.size > 0) {
        const n = t.categories?.name;
        if (!n || !cats.has(n)) return false;
      }
      if (q) {
        const m = (t.merchant || t.description || "").toLowerCase();
        if (!m.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, month, cats, search]);

  function toggleCat(name: string) {
    setCats((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col">
            <span className="label-sm">Month</span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
            >
              <option value="all">All</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <div className="relative">
            <p className="label-sm">Categories</p>
            <button
              onClick={() => setCatsOpen((o) => !o)}
              className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-sm"
            >
              {cats.size === 0 ? "All" : `${cats.size} selected`}
              <ChevronDown className="h-3 w-3" />
            </button>
            {catsOpen && (
              <div className="absolute z-10 mt-1 max-h-56 w-56 overflow-auto rounded-md border border-border bg-card p-2 shadow-lg">
                {categoryOptions.length === 0 && (
                  <p className="p-2 text-xs text-muted">No categories</p>
                )}
                {categoryOptions.map((c) => (
                  <label
                    key={c.name}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-card-hover"
                  >
                    <input
                      type="checkbox"
                      checked={cats.has(c.name)}
                      onChange={() => toggleCat(c.name)}
                    />
                    {c.color && (
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: c.color }}
                      />
                    )}
                    <span className="truncate">{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="flex flex-1 flex-col">
            <span className="label-sm">Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Merchant or description"
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
            />
          </label>
        </div>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No transactions match.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((t) => {
              const amt = toNum(t.amount);
              const positive = t.is_income;
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-3 py-2 text-sm"
                >
                  <span className="w-20 shrink-0 text-muted">
                    {formatDate(t.date)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate">
                      {t.ai_categorized && (
                        <Sparkles
                          className="h-3 w-3 shrink-0 text-terracotta"
                          aria-label="AI categorized"
                        />
                      )}
                      <span className="truncate">
                        {t.merchant || t.description || "—"}
                      </span>
                    </div>
                    {t.categories && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            background: t.categories.color ?? "var(--border)",
                          }}
                        />
                        {t.categories.name}
                      </div>
                    )}
                  </div>
                  <span
                    className={`num font-medium ${
                      positive ? "text-surplus" : "text-deficit"
                    }`}
                  >
                    {positive ? "+" : "−"}
                    {formatCurrency(Math.abs(amt))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- statements shim --------------------------------------------------
// Wraps the real StatementsTab component (Feature 2). If that file isn't in
// place at build time the import above will fail — but since the task expects
// it, we keep the direct import. The render below is a thin passthrough.

function StatementsShim({
  accountId,
  statements,
}: {
  accountId: string;
  statements: StatementRecord[];
}) {
  // Normalize server-provided rows (numeric | string) into the shape the
  // external StatementsTab expects (AccountStatement — numbers + nullable
  // plaid_statement_id/downloaded_at).
  const normalized: AccountStatement[] = statements.map((s) => ({
    id: s.id,
    account_id: s.account_id,
    plaid_statement_id: null,
    period_start: s.period_start,
    period_end: s.period_end,
    opening_balance:
      s.opening_balance === null ? null : Number(s.opening_balance),
    closing_balance:
      s.closing_balance === null ? null : Number(s.closing_balance),
    total_debits: s.total_debits === null ? null : Number(s.total_debits),
    total_credits: s.total_credits === null ? null : Number(s.total_credits),
    storage_path: s.storage_path,
    byte_size: s.byte_size,
    downloaded_at: s.downloaded_at,
    created_at: s.created_at,
  }));

  if (typeof ExternalStatementsTab === "function") {
    return (
      <ExternalStatementsTab accountId={accountId} statements={normalized} />
    );
  }
  // Unreachable when the external tab exists; TS guardrail for the build.
  return (
    <Card>
      <p className="text-sm text-muted">
        Statements view unavailable in this build.
      </p>
    </Card>
  );
}

// ---------- insights tab -----------------------------------------------------

function InsightsTab({
  account,
  transactions,
  snapshots,
  debt,
}: {
  account: AccountSummary;
  transactions: TransactionRecord[];
  snapshots: SnapshotRecord[];
  debt: DebtRecord | null;
}) {
  const avg30 = useAvgDailyBalance(account, snapshots, transactions, 30);
  const avg90 = useAvgDailyBalance(account, snapshots, transactions, 90);
  const avg365 = useAvgDailyBalance(account, snapshots, transactions, 365);

  const { topDeposits, topWithdrawals } = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffYmd = cutoff.toISOString().slice(0, 10);
    const recent = transactions.filter((t) => t.date >= cutoffYmd);
    const deposits = recent
      .filter((t) => t.is_income)
      .sort((a, b) => toNum(b.amount) - toNum(a.amount))
      .slice(0, 5);
    const withdrawals = recent
      .filter((t) => !t.is_income)
      .sort((a, b) => toNum(b.amount) - toNum(a.amount))
      .slice(0, 5);
    return { topDeposits: deposits, topWithdrawals: withdrawals };
  }, [transactions]);

  const recurringDeposits = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffYmd = cutoff.toISOString().slice(0, 10);
    const groups = new Map<
      string,
      { merchant: string; amount: number; count: number; lastDate: string }
    >();
    for (const t of transactions) {
      if (!t.is_income) continue;
      if (t.date < cutoffYmd) continue;
      const merchant = (t.merchant || t.description || "Unknown").trim();
      const amt = Math.round(Math.abs(toNum(t.amount)) * 100) / 100;
      const key = `${merchant}|${amt}`;
      const cur = groups.get(key);
      if (cur) {
        cur.count += 1;
        if (t.date > cur.lastDate) cur.lastDate = t.date;
      } else {
        groups.set(key, {
          merchant,
          amount: amt,
          count: 1,
          lastDate: t.date,
        });
      }
    }
    return Array.from(groups.values())
      .filter((g) => g.count >= 2)
      .sort((a, b) => b.count - a.count || b.amount - a.amount);
  }, [transactions]);

  const payoffProgress = useMemo(() => {
    if (!debt) return null;
    const orig = toNum(debt.original_balance ?? null);
    const bal = toNum(debt.current_balance);
    if (orig <= 0) return null;
    return Math.min(100, Math.max(0, ((orig - bal) / orig) * 100));
  }, [debt]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Avg balance · 30d" value={formatCurrency(avg30)} />
        <StatCard label="Avg balance · 90d" value={formatCurrency(avg90)} />
        <StatCard label="Avg balance · 365d" value={formatCurrency(avg365)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-surplus" />
            <p className="label-sm">Largest deposits · 30d</p>
          </div>
          {topDeposits.length === 0 ? (
            <p className="text-sm text-muted">No deposits in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-border">
              {topDeposits.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted">{formatDate(t.date)}</span>{" "}
                    · {t.merchant || t.description || "—"}
                  </span>
                  <span className="num font-medium text-surplus">
                    +{formatCurrency(Math.abs(toNum(t.amount)))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-deficit" />
            <p className="label-sm">Largest withdrawals · 30d</p>
          </div>
          {topWithdrawals.length === 0 ? (
            <p className="text-sm text-muted">No withdrawals in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-border">
              {topWithdrawals.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted">{formatDate(t.date)}</span>{" "}
                    · {t.merchant || t.description || "—"}
                  </span>
                  <span className="num font-medium text-deficit">
                    −{formatCurrency(Math.abs(toNum(t.amount)))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <p className="label-sm mb-2">Detected recurring deposits</p>
        {recurringDeposits.length === 0 ? (
          <p className="text-sm text-muted">
            No recurring income detected in the last 90 days.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recurringDeposits.map((g) => (
              <li
                key={`${g.merchant}-${g.amount}`}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {g.merchant}
                  <span className="ml-2 text-xs text-muted">
                    {g.count}× · last {formatDate(g.lastDate)}
                  </span>
                </span>
                <span className="num font-medium text-surplus">
                  {formatCurrency(g.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {debt && payoffProgress !== null && (
        <Card accent="green">
          <div className="mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-surplus" />
            <p className="label-sm">Payoff progress</p>
          </div>
          <p className="display-value num">{payoffProgress.toFixed(1)}%</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-card-hover">
            <div
              className="h-full bg-surplus"
              style={{ width: `${payoffProgress}%` }}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

function useAvgDailyBalance(
  account: AccountSummary,
  snapshots: SnapshotRecord[],
  transactions: TransactionRecord[],
  days: number
): number {
  return useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - days + 1);
    const startYmd = start.toISOString().slice(0, 10);
    const liability = isLiability(account.type);

    // If we have per-day snapshots, just average those that fall in the window.
    const filtered = snapshots.filter((s) => s.snapshot_date >= startYmd);
    if (filtered.length >= days * 0.7) {
      const sum = filtered.reduce(
        (acc, s) =>
          acc +
          (liability
            ? Math.abs(toNum(s.current_balance))
            : toNum(s.current_balance)),
        0
      );
      return sum / filtered.length;
    }

    // Fallback: reconstruct a daily series by walking transactions backward
    // from current balance. Not precise — close enough for a quick read.
    const balances: number[] = [];
    let bal = liability
      ? Math.abs(account.current_balance)
      : account.current_balance;
    const txnByDay = new Map<string, number>();
    for (const t of transactions) {
      const amt = Math.abs(toNum(t.amount));
      const delta = liability
        ? t.is_income
          ? -amt
          : amt
        : t.is_income
          ? amt
          : -amt;
      txnByDay.set(t.date, (txnByDay.get(t.date) ?? 0) + delta);
    }
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      balances.push(bal);
      bal -= txnByDay.get(k) ?? 0;
    }
    return balances.reduce((a, b) => a + b, 0) / balances.length;
  }, [account, snapshots, transactions, days]);
}

// ---------- tiny primitives --------------------------------------------------

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-sm">{label}</p>
      <p className="num mt-1 font-semibold">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-muted">
      {label}
    </div>
  );
}
