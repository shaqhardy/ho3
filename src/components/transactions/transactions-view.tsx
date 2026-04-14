"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Download,
  FileText,
  Filter,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Receipt,
  Split,
  Trash2,
  X,
} from "lucide-react";
import { Card, ElevatedCard } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import type {
  TxnRow,
  CatRow,
  AcctRow,
  BillRow,
} from "@/lib/transactions/load";
import type { Book } from "@/lib/types";

type SortKey = "date" | "merchant" | "amount" | "category" | "account";
type SortDir = "asc" | "desc";

interface Props {
  book: Book;
  bookLabel: string;
  transactions: TxnRow[];
  categories: CatRow[];
  accounts: AcctRow[];
  bills: BillRow[];
  completeness: {
    pct_of_expenses: number;
    expense_uncategorized: number;
    expense_total: number;
  };
}

const DATE_PRESETS = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "all", label: "All", days: null as number | null },
  { id: "custom", label: "Custom", days: null as number | null },
] as const;

export function TransactionsView({
  book,
  bookLabel,
  transactions,
  categories,
  accounts,
  bills,
  completeness,
}: Props) {
  const router = useRouter();

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [datePreset, setDatePreset] =
    useState<(typeof DATE_PRESETS)[number]["id"]>("30");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const [accountIds, setAccountIds] = useState<Set<string>>(new Set());
  const [categoryIds, setCategoryIds] = useState<Set<string | "uncat">>(
    new Set()
  );
  const [merchantSearch, setMerchantSearch] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<TxnRow | null>(null);

  const [bulkCatOpen, setBulkCatOpen] = useState(false);
  const [bulkCatValue, setBulkCatValue] = useState<string>("");
  const [bulkCreateRule, setBulkCreateRule] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);

  const acctById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  // Build the filter date window.
  const { fromDate, toDate } = useMemo(() => {
    if (datePreset === "custom") {
      return { fromDate: customFrom || null, toDate: customTo || null };
    }
    const preset = DATE_PRESETS.find((p) => p.id === datePreset);
    if (!preset || preset.days === null)
      return { fromDate: null, toDate: null };
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - preset.days);
    return {
      fromDate: from.toISOString().slice(0, 10),
      toDate: today.toISOString().slice(0, 10),
    };
  }, [datePreset, customFrom, customTo]);

  // Split parents are hidden when they have children (children represent the
  // real categorization); otherwise show the parent as normal.
  const childParents = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.split_parent_id) set.add(t.split_parent_id);
    }
    return set;
  }, [transactions]);

  const filtered = useMemo(() => {
    const search = merchantSearch.trim().toLowerCase();
    const rows = transactions.filter((t) => {
      if (childParents.has(t.id)) return false;
      if (fromDate && t.date < fromDate) return false;
      if (toDate && t.date > toDate) return false;
      if (accountIds.size > 0 && (!t.account_id || !accountIds.has(t.account_id)))
        return false;
      if (categoryIds.size > 0) {
        if (t.category_id === null && !categoryIds.has("uncat")) return false;
        if (t.category_id !== null && !categoryIds.has(t.category_id))
          return false;
      }
      if (search) {
        const m = (t.merchant || t.description || "").toLowerCase();
        if (!m.includes(search)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "date":
          return (a.date.localeCompare(b.date) || 0) * dir;
        case "merchant":
          return (
            (a.merchant || a.description || "").localeCompare(
              b.merchant || b.description || ""
            ) * dir
          );
        case "amount":
          return (Number(a.amount) - Number(b.amount)) * dir;
        case "category":
          return (
            (a.categories?.name || "").localeCompare(
              b.categories?.name || ""
            ) * dir
          );
        case "account": {
          const an = a.account_id ? acctById.get(a.account_id)?.name ?? "" : "";
          const bn = b.account_id ? acctById.get(b.account_id)?.name ?? "" : "";
          return an.localeCompare(bn) * dir;
        }
      }
    });

    return rows;
  }, [
    transactions,
    childParents,
    fromDate,
    toDate,
    accountIds,
    categoryIds,
    merchantSearch,
    sortKey,
    sortDir,
    acctById,
  ]);

  const runningStats = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filtered) {
      const amt = Number(t.amount);
      if (t.is_income) income += amt;
      else expense += amt;
    }
    return { income, expense, net: income - expense, count: filtered.length };
  }, [filtered]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((t) => selected.has(t.id));

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "date" ? "desc" : "asc");
    }
  }

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((t) => t.id)));
    }
  }

  const toggleAcct = (id: string) =>
    setAccountIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleCat = (id: string | "uncat") =>
    setCategoryIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function clearFilters() {
    setDatePreset("30");
    setCustomFrom("");
    setCustomTo("");
    setAccountIds(new Set());
    setCategoryIds(new Set());
    setMerchantSearch("");
  }

  async function runBulkCategorize() {
    if (selected.size === 0 || !bulkCatValue) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/transactions/bulk-categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          category_id: bulkCatValue === "__uncat__" ? null : bulkCatValue,
          create_rules: bulkCreateRule,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setSelected(new Set());
      setBulkCatOpen(false);
      setBulkCatValue("");
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Recategorize failed");
    } finally {
      setBulkBusy(false);
    }
  }

  function downloadCsv() {
    const header = [
      "date",
      "merchant",
      "description",
      "amount",
      "is_income",
      "category",
      "account",
      "mask",
      "notes",
      "plaid_transaction_id",
    ];
    const rows = filtered.map((t) => {
      const acct = t.account_id ? acctById.get(t.account_id) : null;
      return [
        t.date,
        t.merchant ?? "",
        t.description ?? "",
        Number(t.amount).toFixed(2),
        t.is_income ? "income" : "expense",
        t.categories?.name ?? "",
        acct?.name ?? "",
        acct?.mask ?? "",
        t.notes ?? "",
        t.plaid_transaction_id ?? "",
      ];
    });
    const csv =
      [header, ...rows]
        .map((r) =>
          r
            .map((v) => {
              const s = String(v ?? "");
              if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
              return s;
            })
            .join(",")
        )
        .join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${book}-transactions-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="has-bottom-nav space-y-5 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-sm">{bookLabel}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Transactions
          </h1>
          <p className="text-xs text-muted">
            {transactions.length} total · showing {filtered.length} ·{" "}
            <span
              className={
                completeness.pct_of_expenses >= 95
                  ? "text-surplus"
                  : completeness.pct_of_expenses >= 75
                    ? "text-warning"
                    : "text-deficit"
              }
            >
              {completeness.pct_of_expenses}% categorized
            </span>
            {completeness.expense_uncategorized > 0 && (
              <>
                {" · "}
                <a
                  href={`/${book}/categorize`}
                  className="text-terracotta hover:underline"
                >
                  {completeness.expense_uncategorized} to clean up →
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-card px-3 py-2 text-xs font-medium text-muted hover:text-foreground disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </header>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted" />
          <span className="label-sm">Filters</span>
          <div className="flex-1" />
          <button
            onClick={clearFilters}
            className="text-xs text-muted hover:text-foreground"
          >
            Reset
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {/* Date presets */}
          <div className="flex flex-wrap gap-1">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setDatePreset(p.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  datePreset === p.id
                    ? "border-terracotta bg-terracotta/10 text-terracotta"
                    : "border-border-subtle text-muted hover:border-border hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
            {datePreset === "custom" && (
              <>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setCustomFrom(e.target.value)
                  }
                  className="rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-xs"
                />
                <span className="text-xs text-muted self-center">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setCustomTo(e.target.value)
                  }
                  className="rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-xs"
                />
              </>
            )}
          </div>

          {/* Merchant + multi-selects */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              placeholder="Search merchant / description"
              value={merchantSearch}
              onChange={(e) => setMerchantSearch(e.target.value)}
              className="rounded-lg border border-border-subtle bg-card px-3 py-1.5 text-sm"
            />
            <details className="rounded-lg border border-border-subtle bg-card">
              <summary className="cursor-pointer list-none px-3 py-1.5 text-sm">
                Accounts
                {accountIds.size > 0 && (
                  <span className="ml-1 text-xs text-terracotta">
                    ({accountIds.size})
                  </span>
                )}
              </summary>
              <ul className="max-h-56 overflow-y-auto p-2 text-sm">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-2 rounded px-1 py-1 hover:bg-card-hover">
                      <input
                        type="checkbox"
                        checked={accountIds.has(a.id)}
                        onChange={() => toggleAcct(a.id)}
                      />
                      <span className="truncate">
                        {a.name}
                        {a.mask && (
                          <span className="ml-1 text-xs text-muted">
                            ••{a.mask}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
                {accounts.length === 0 && (
                  <li className="px-1 py-1 text-xs text-muted">No accounts</li>
                )}
              </ul>
            </details>
            <details className="rounded-lg border border-border-subtle bg-card">
              <summary className="cursor-pointer list-none px-3 py-1.5 text-sm">
                Categories
                {categoryIds.size > 0 && (
                  <span className="ml-1 text-xs text-terracotta">
                    ({categoryIds.size})
                  </span>
                )}
              </summary>
              <ul className="max-h-56 overflow-y-auto p-2 text-sm">
                <li>
                  <label className="flex items-center gap-2 rounded px-1 py-1 hover:bg-card-hover">
                    <input
                      type="checkbox"
                      checked={categoryIds.has("uncat")}
                      onChange={() => toggleCat("uncat")}
                    />
                    Uncategorized
                  </label>
                </li>
                {categories.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 rounded px-1 py-1 hover:bg-card-hover">
                      <input
                        type="checkbox"
                        checked={categoryIds.has(c.id)}
                        onChange={() => toggleCat(c.id)}
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-terracotta/30 bg-terracotta/10 p-3 text-sm backdrop-blur">
          <span className="font-medium">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setBulkCatOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white"
          >
            <Pencil className="h-3 w-3" /> Recategorize
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card-depth overflow-hidden rounded-xl border border-border-subtle bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border-subtle bg-card-hover text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <SortHeader k="date" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Date
              </SortHeader>
              <SortHeader k="merchant" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Merchant
              </SortHeader>
              <SortHeader k="amount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">
                Amount
              </SortHeader>
              <SortHeader k="category" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Category
              </SortHeader>
              <SortHeader k="account" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Account
              </SortHeader>
              <th className="w-10 px-2 py-2 text-right">
                <span className="sr-only">Notes</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No transactions match these filters.
                </td>
              </tr>
            )}
            {filtered.map((t) => {
              const acct = t.account_id ? acctById.get(t.account_id) : null;
              const amt = Number(t.amount);
              const isSel = selected.has(t.id);
              return (
                <tr
                  key={t.id}
                  className={`cursor-pointer transition hover:bg-card-hover ${
                    isSel ? "bg-terracotta/5" : ""
                  }`}
                  onClick={() => setDetail(t)}
                >
                  <td
                    className="w-8 px-2 py-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSel(t.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSel(t.id)}
                      aria-label="Select row"
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted num">
                    {formatDate(t.date)}
                  </td>
                  <td className="px-2 py-2">
                    <p className="truncate font-medium text-foreground">
                      {t.merchant || t.description || "—"}
                    </p>
                    {t.description && t.merchant && (
                      <p className="truncate text-xs text-muted">
                        {t.description}
                      </p>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-2 py-2 text-right num font-semibold ${
                      t.is_income ? "text-surplus" : ""
                    }`}
                  >
                    {t.is_income ? "+" : "-"}
                    {formatCurrency(amt)}
                  </td>
                  <td className="px-2 py-2">
                    {t.categories?.name ? (
                      <span className="rounded bg-card-hover px-1.5 py-0.5 text-xs">
                        {t.categories.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted italic">
                        Uncategorized
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted">
                    {acct?.name || "—"}
                    {acct?.mask && (
                      <span className="ml-1">••{acct.mask}</span>
                    )}
                  </td>
                  <td className="w-10 px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-1 text-muted">
                      {t.notes && <FileText className="h-3 w-3" />}
                      {t.receipt_url && <Paperclip className="h-3 w-3" />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="border-t-2 border-border bg-card-hover text-sm">
              <tr>
                <td className="px-2 py-2" />
                <td className="px-2 py-2 text-xs text-muted" colSpan={2}>
                  {runningStats.count} rows
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  <p className="num font-semibold">
                    <span
                      className={
                        runningStats.net >= 0 ? "text-surplus" : "text-deficit"
                      }
                    >
                      {runningStats.net >= 0 ? "+" : ""}
                      {formatCurrency(runningStats.net)}
                    </span>
                  </p>
                  <p className="text-[10px] text-muted num">
                    +{formatCurrency(runningStats.income)} / −
                    {formatCurrency(runningStats.expense)}
                  </p>
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Bulk dialog */}
      {bulkCatOpen && (
        <BulkDialog
          onClose={() => setBulkCatOpen(false)}
          categories={categories}
          value={bulkCatValue}
          onValue={setBulkCatValue}
          createRule={bulkCreateRule}
          onCreateRule={setBulkCreateRule}
          busy={bulkBusy}
          onSubmit={runBulkCategorize}
          count={selected.size}
        />
      )}

      {/* Detail modal */}
      {detail && (
        <TxnDetail
          txn={detail}
          categories={categories}
          accounts={accounts}
          bills={bills}
          transactions={transactions}
          onClose={() => setDetail(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function SortHeader({
  k,
  current,
  dir,
  onClick,
  children,
  align = "left",
}: {
  k: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const active = current === k;
  return (
    <th
      className={`px-2 py-2 text-${align} font-medium`}
    >
      <button
        className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""}`}
        onClick={() => onClick(k)}
      >
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function BulkDialog({
  onClose,
  categories,
  value,
  onValue,
  createRule,
  onCreateRule,
  busy,
  onSubmit,
  count,
}: {
  onClose: () => void;
  categories: CatRow[];
  value: string;
  onValue: (v: string) => void;
  createRule: boolean;
  onCreateRule: (v: boolean) => void;
  busy: boolean;
  onSubmit: () => void;
  count: number;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recategorize {count}</h2>
          <button onClick={onClose} className="text-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block text-sm">
          <span className="label-sm">Category</span>
          <select
            value={value}
            onChange={(e) => onValue(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-2 text-sm"
          >
            <option value="">Select category…</option>
            <option value="__uncat__">— Uncategorized —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={createRule}
            onChange={(e) => onCreateRule(e.target.checked)}
          />
          Remember this merchant→category mapping for future transactions
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={busy || !value}
            className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function TxnDetail({
  txn,
  categories,
  accounts,
  bills,
  transactions,
  onClose,
  onChanged,
}: {
  txn: TxnRow;
  categories: CatRow[];
  accounts: AcctRow[];
  bills: BillRow[];
  transactions: TxnRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string>(txn.category_id ?? "");
  const [notes, setNotes] = useState<string>(txn.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [createRule, setCreateRule] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);

  const children = useMemo(
    () => transactions.filter((t) => t.split_parent_id === txn.id),
    [transactions, txn.id]
  );

  // Heuristic: find a bill that shares the merchant's name (case-insensitive substring match).
  const linkedBill = useMemo(() => {
    if (!txn.merchant) return null;
    const m = txn.merchant.toLowerCase();
    return (
      bills.find((b) => m.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(m)) ||
      null
    );
  }, [txn.merchant, bills]);

  const acct = accounts.find((a) => a.id === txn.account_id) || null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/transactions/${txn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: categoryId || null,
          notes: notes || null,
          create_rule: createRule && !!categoryId,
        }),
      });
      if (!res.ok) throw new Error();
      onChanged();
      onClose();
    } catch {
      alert("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadReceipt(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/transactions/${txn.id}/receipt`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function removeReceipt() {
    const res = await fetch(`/api/transactions/${txn.id}/receipt`, {
      method: "DELETE",
    });
    if (res.ok) onChanged();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="label-sm">{formatDate(txn.date)}</p>
            <h2 className="mt-1 text-lg font-semibold">
              {txn.merchant || txn.description || "—"}
            </h2>
            <p
              className={`num text-2xl font-bold ${txn.is_income ? "text-surplus" : ""}`}
            >
              {txn.is_income ? "+" : "-"}
              {formatCurrency(Number(txn.amount))}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          {txn.description && txn.description !== txn.merchant && (
            <div>
              <p className="label-sm">Plaid description</p>
              <p className="mt-0.5 text-foreground">{txn.description}</p>
            </div>
          )}

          <div>
            <p className="label-sm">Account</p>
            <p className="mt-0.5">
              {acct ? (
                <>
                  {acct.name}
                  {acct.mask && (
                    <span className="ml-1 text-xs text-muted">
                      ••{acct.mask}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted">No account</span>
              )}
            </p>
          </div>

          <div>
            <label className="label-sm">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5 text-sm"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {categoryId && categoryId !== (txn.category_id ?? "") && (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={createRule}
                  onChange={(e) => setCreateRule(e.target.checked)}
                />
                Apply to future transactions from{" "}
                <span className="font-medium text-foreground">
                  {txn.merchant || "this merchant"}
                </span>
              </label>
            )}
          </div>

          <div>
            <label className="label-sm">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5 text-sm"
              placeholder="Add a note…"
            />
          </div>

          <div>
            <p className="label-sm mb-1">Receipt</p>
            {txn.receipt_url ? (
              <div className="flex items-center gap-2">
                <a
                  href={txn.receipt_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-2 py-1 text-xs text-terracotta hover:underline"
                >
                  <Receipt className="h-3 w-3" />
                  View receipt
                </a>
                <button
                  onClick={removeReceipt}
                  className="text-xs text-muted hover:text-deficit"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground">
                {uploading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                Upload receipt
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={uploadReceipt}
                />
              </label>
            )}
          </div>

          {linkedBill && (
            <div className="rounded-lg border border-border-subtle bg-card-hover p-3 text-xs">
              <p className="label-sm mb-1">Possible bill match</p>
              <p className="font-medium text-foreground">{linkedBill.name}</p>
              <p className="mt-0.5 text-muted">
                Bills that auto-match to transactions are marked paid during
                sync. Manage in Bills.
              </p>
            </div>
          )}

          {children.length > 0 && (
            <div>
              <p className="label-sm mb-1">Split into {children.length} parts</p>
              <ul className="space-y-1">
                {children.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded border border-border-subtle px-2 py-1 text-xs"
                  >
                    <span>
                      {c.categories?.name || "Uncategorized"}
                      {c.notes && <span className="text-muted"> · {c.notes}</span>}
                    </span>
                    <span className="num font-medium">
                      {formatCurrency(Number(c.amount))}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={async () => {
                  if (!confirm("Remove the split and restore this single transaction?"))
                    return;
                  const res = await fetch(
                    `/api/transactions/${txn.id}/split`,
                    { method: "DELETE" }
                  );
                  if (res.ok) {
                    onChanged();
                    onClose();
                  }
                }}
                className="mt-2 text-xs text-muted hover:text-deficit"
              >
                Unsplit
              </button>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-between gap-2">
          {children.length === 0 && (
            <button
              onClick={() => setSplitOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              <Split className="h-3 w-3" /> Split
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
          >
            Close
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Save
          </button>
        </div>

        {splitOpen && (
          <SplitDialog
            parent={txn}
            categories={categories}
            onClose={() => setSplitOpen(false)}
            onSplit={() => {
              onChanged();
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function SplitDialog({
  parent,
  categories,
  onClose,
  onSplit,
}: {
  parent: TxnRow;
  categories: CatRow[];
  onClose: () => void;
  onSplit: () => void;
}) {
  const [splits, setSplits] = useState<
    { amount: string; category_id: string; notes: string }[]
  >([
    { amount: "", category_id: parent.category_id ?? "", notes: "" },
    { amount: "", category_id: "", notes: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const total = splits.reduce((s, x) => s + Number(x.amount || 0), 0);
  const target = Number(parent.amount);
  const diff = target - total;

  function update(i: number, field: string, value: string) {
    setSplits((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function add() {
    setSplits((p) => [...p, { amount: "", category_id: "", notes: "" }]);
  }
  function remove(i: number) {
    setSplits((p) => p.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (Math.abs(diff) > 0.01) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${parent.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splits: splits.map((s) => ({
            amount: Number(s.amount),
            category_id: s.category_id || null,
            notes: s.notes || null,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Split failed");
      }
      onSplit();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Split {formatCurrency(target)}
          </h2>
          <button onClick={onClose} className="text-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          {splits.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={s.amount}
                onChange={(e) => update(i, "amount", e.target.value)}
                className="rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-sm"
              />
              <select
                value={s.category_id}
                onChange={(e) => update(i, "category_id", e.target.value)}
                className="rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-sm"
              >
                <option value="">Category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => remove(i)}
                disabled={splits.length <= 2}
                className="text-muted hover:text-deficit disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={add}
          className="mt-2 inline-flex items-center gap-1 text-xs text-terracotta"
        >
          <Plus className="h-3 w-3" /> Add split
        </button>
        <p
          className={`mt-3 text-xs ${
            Math.abs(diff) < 0.01 ? "text-surplus" : "text-warning"
          }`}
        >
          Total {formatCurrency(total)} / {formatCurrency(target)}
          {Math.abs(diff) >= 0.01 && (
            <> · {diff > 0 ? `need ${formatCurrency(diff)}` : `over by ${formatCurrency(-diff)}`}</>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || Math.abs(diff) > 0.01}
            className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Save split
          </button>
        </div>
      </div>
    </div>
  );
}

// unused reserved for future visuals
void ElevatedCard;
