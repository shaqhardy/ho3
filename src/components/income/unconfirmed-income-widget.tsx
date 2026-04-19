"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatShortDate } from "@/lib/format";
import {
  INCOME_CATEGORIES,
  INCOME_CATEGORY_LABELS,
  type IncomeCategory,
  type IncomeEntry,
  type Book,
} from "@/lib/types";
import { BOOK_SHORT_LABELS } from "@/lib/books";

interface Props {
  entries: IncomeEntry[];
  accountsById: Record<string, { name: string; mask: string | null }>;
  title?: string;
}

const inputCls =
  "rounded-md border border-border-subtle bg-card px-2 py-1 text-xs";

export function UnconfirmedIncomeWidget({
  entries,
  accountsById,
  title = "Unconfirmed Income",
}: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingCat, setPendingCat] = useState<
    Record<string, IncomeCategory | undefined>
  >({});
  const [err, setErr] = useState<string | null>(null);

  if (entries.length === 0) return null;

  async function confirm(entry: IncomeEntry) {
    setBusyId(entry.id);
    setErr(null);
    try {
      const category = pendingCat[entry.id] ?? entry.category;
      const res = await fetch(`/api/income/${entry.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || "Confirm failed");
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(entry: IncomeEntry) {
    if (
      !confirm_(
        entry.likely_transfer
          ? "Dismiss this as an internal transfer? It will be removed from income."
          : "Delete this auto-detected entry?"
      )
    )
      return;
    setBusyId(entry.id);
    setErr(null);
    try {
      const res = await fetch(`/api/income/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || "Dismiss failed");
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card accent="warning" className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted">
            {entries.length} Plaid credit{entries.length === 1 ? "" : "s"}{" "}
            detected. Confirm to keep, or dismiss transfers.
          </p>
        </div>
      </div>

      {err && (
        <p className="rounded bg-deficit/10 px-2 py-1 text-xs text-deficit">
          {err}
        </p>
      )}

      <ul className="divide-y divide-border-subtle">
        {entries.map((e) => {
          const acct = e.account_id ? accountsById[e.account_id] : null;
          const date = e.received_date ?? e.expected_date ?? e.created_at;
          const cat = pendingCat[e.id] ?? e.category;
          const busy = busyId === e.id;
          return (
            <li
              key={e.id}
              className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {e.source || "Unknown source"}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted">
                    {BOOK_SHORT_LABELS[e.book as Book]}
                  </span>
                  {e.likely_transfer && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                      <AlertTriangle className="h-2.5 w-2.5" /> Likely transfer
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted num">
                  {formatShortDate(date.slice(0, 10))}
                  {acct && (
                    <>
                      {" · "}
                      {acct.name}
                      {acct.mask && <> ••{acct.mask}</>}
                    </>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <p className="num text-sm font-semibold text-surplus">
                  +{formatCurrency(Number(e.amount))}
                </p>
                <select
                  value={cat}
                  onChange={(ev) =>
                    setPendingCat((p) => ({
                      ...p,
                      [e.id]: ev.target.value as IncomeCategory,
                    }))
                  }
                  className={inputCls}
                  disabled={busy}
                >
                  {INCOME_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {INCOME_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => confirm(e)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-surplus/40 bg-surplus/10 px-2 py-1 text-xs font-medium text-surplus disabled:opacity-50"
                  title="Confirm"
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(e)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-2 py-1 text-xs text-muted hover:text-deficit disabled:opacity-50"
                  title={
                    e.likely_transfer ? "Dismiss as transfer" : "Delete"
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Alias window.confirm — naming collision with our local confirm() function.
function confirm_(msg: string): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm(msg);
}
