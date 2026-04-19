"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Filter as FilterIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { BOOK_LABELS } from "@/lib/books";
import {
  INCOME_CATEGORIES,
  INCOME_CATEGORY_LABELS,
  type Book,
  type IncomeCategory,
  type IncomeEntry,
} from "@/lib/types";
import {
  AddIncomeDialog,
  type IncomeDialogAccount,
} from "@/components/income/add-income-dialog";

interface Props {
  entries: IncomeEntry[];
  accounts: IncomeDialogAccount[];
  availableBooks: Book[];
}

const inputCls =
  "rounded-lg border border-border-subtle bg-card px-2 py-1 text-sm";

export function IncomeView({ entries, accounts, availableBooks }: Props) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<IncomeEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [books, setBooks] = useState<Set<Book>>(new Set());
  const [accountIds, setAccountIds] = useState<Set<string>>(new Set());
  const [sourceQ, setSourceQ] = useState("");
  const [category, setCategory] = useState<IncomeCategory | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includePending, setIncludePending] = useState(false);

  const accountsById = useMemo(() => {
    const m: Record<string, { name: string; mask: string | null }> = {};
    for (const a of accounts) m[a.id] = { name: a.name, mask: a.mask };
    return m;
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = sourceQ.trim().toLowerCase();
    return entries.filter((e) => {
      if (!includePending && !e.is_confirmed) return false;
      if (books.size > 0 && !books.has(e.book as Book)) return false;
      if (accountIds.size > 0) {
        if (!e.account_id || !accountIds.has(e.account_id)) return false;
      }
      if (category && e.category !== category) return false;
      if (q) {
        const s = (e.source || "").toLowerCase();
        if (!s.includes(q)) return false;
      }
      const date = e.received_date ?? e.expected_date ?? null;
      if (from && (!date || date < from)) return false;
      if (to && (!date || date > to)) return false;
      return true;
    });
  }, [entries, books, accountIds, sourceQ, category, from, to, includePending]);

  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);

  function toggleBook(b: Book) {
    setBooks((p) => {
      const n = new Set(p);
      if (n.has(b)) n.delete(b);
      else n.add(b);
      return n;
    });
  }
  function toggleAccount(id: string) {
    setAccountIds((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function clearFilters() {
    setBooks(new Set());
    setAccountIds(new Set());
    setSourceQ("");
    setCategory("");
    setFrom("");
    setTo("");
    setIncludePending(false);
  }

  function exportCsvUrl() {
    const sp = new URLSearchParams();
    if (books.size === 1) sp.set("book", [...books][0]);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (category) sp.set("category", category);
    if (sourceQ.trim()) sp.set("source", sourceQ.trim());
    return `/api/income/export?${sp.toString()}`;
  }

  async function remove(entry: IncomeEntry) {
    if (!window.confirm("Delete this income entry?")) return;
    setBusyId(entry.id);
    setErr(null);
    try {
      const res = await fetch(`/api/income/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || "Delete failed");
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const accountsForFilter = accounts.filter((a) =>
    books.size === 0 ? true : books.has(a.book)
  );

  return (
    <div className="has-bottom-nav space-y-5 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-sm">All books</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Income</h1>
          <p className="text-xs text-muted">
            {filtered.length} entries · {formatCurrency(total)} total
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={exportCsvUrl()}
            className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </a>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" /> Add income
          </button>
        </div>
      </header>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterIcon className="h-3.5 w-3.5 text-muted" />
          <p className="label-sm">Filters</p>
          {(books.size > 0 ||
            accountIds.size > 0 ||
            sourceQ ||
            category ||
            from ||
            to ||
            includePending) && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-0.5 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground"
            >
              <X className="h-2.5 w-2.5" /> Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          {availableBooks.map((b) => {
            const on = books.has(b);
            return (
              <button
                key={b}
                type="button"
                onClick={() => toggleBook(b)}
                className={`rounded-full border px-2 py-0.5 ${
                  on
                    ? "border-terracotta bg-terracotta/10 text-terracotta"
                    : "border-border-subtle text-muted hover:text-foreground"
                }`}
              >
                {BOOK_LABELS[b]}
              </button>
            );
          })}
        </div>

        {accountsForFilter.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {accountsForFilter.map((a) => {
              const on = accountIds.has(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAccount(a.id)}
                  className={`rounded-full border px-2 py-0.5 ${
                    on
                      ? "border-terracotta bg-terracotta/10 text-terracotta"
                      : "border-border-subtle text-muted hover:text-foreground"
                  }`}
                >
                  {a.name}
                  {a.mask && <span className="ml-1 text-muted">••{a.mask}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input
            type="text"
            placeholder="Search source"
            value={sourceQ}
            onChange={(e) => setSourceQ(e.target.value)}
            className={inputCls}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as IncomeCategory | "")}
            className={inputCls}
          >
            <option value="">All categories</option>
            {INCOME_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {INCOME_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputCls}
            aria-label="From date"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputCls}
            aria-label="To date"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={includePending}
            onChange={(e) => setIncludePending(e.target.checked)}
          />
          Include unconfirmed (Plaid-detected, not yet reviewed)
        </label>
      </Card>

      {err && (
        <div className="rounded bg-deficit/10 px-3 py-2 text-sm text-deficit">
          {err}
        </div>
      )}

      <div className="card-depth overflow-hidden rounded-xl border border-border-subtle bg-card">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            No income entries match these filters.
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {filtered.map((e) => {
              const acct = e.account_id ? accountsById[e.account_id] : null;
              const date =
                e.received_date ?? e.expected_date ?? e.created_at;
              const busy = busyId === e.id;
              return (
                <li
                  key={e.id}
                  className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {e.source || "Unspecified source"}
                      </span>
                      <span className="rounded bg-card-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {INCOME_CATEGORY_LABELS[e.category]}
                      </span>
                      <span className="rounded bg-card-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {BOOK_LABELS[e.book as Book]}
                      </span>
                      {!e.is_confirmed && (
                        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                          Pending
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted num">
                      {formatDate(date.slice(0, 10))}
                      {acct && (
                        <>
                          {" · "}
                          {acct.name}
                          {acct.mask && <> ••{acct.mask}</>}
                        </>
                      )}
                      {e.notes && (
                        <span className="text-muted italic"> · {e.notes}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="num text-sm font-semibold text-surplus">
                      +{formatCurrency(Number(e.amount))}
                    </p>
                    <button
                      type="button"
                      onClick={() => setEditing(e)}
                      disabled={busy}
                      className="rounded-lg border border-border-subtle p-1 text-muted hover:text-foreground disabled:opacity-50"
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(e)}
                      disabled={busy}
                      className="rounded-lg border border-border-subtle p-1 text-muted hover:text-deficit disabled:opacity-50"
                      title="Delete"
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AddIncomeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        accounts={accounts}
        availableBooks={availableBooks}
      />
      <AddIncomeDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing}
        accounts={accounts}
        availableBooks={availableBooks}
      />
    </div>
  );
}
