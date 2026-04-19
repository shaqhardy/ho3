"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { INCOME_CATEGORY_LABELS, type IncomeEntry } from "@/lib/types";
import {
  AddIncomeDialog,
  type IncomeDialogAccount,
} from "@/components/income/add-income-dialog";
import type { Book } from "@/lib/types";

interface Props {
  entries: IncomeEntry[];
  accounts: IncomeDialogAccount[];
  availableBooks: Book[];
  accountsById: Record<string, { name: string; mask: string | null }>;
  title?: string;
  limit?: number;
}

export function IncomeList({
  entries,
  accounts,
  availableBooks,
  accountsById,
  title = "Recent income",
  limit = 20,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<IncomeEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const visible = entries.slice(0, limit);

  async function remove(entry: IncomeEntry) {
    if (!window.confirm(`Delete this income entry?`)) return;
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

  if (visible.length === 0) {
    return (
      <Card>
        <p className="label-sm">{title}</p>
        <p className="mt-2 text-sm text-muted">No income logged yet.</p>
      </Card>
    );
  }

  return (
    <>
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="label-sm">{title}</p>
          <span className="text-xs text-muted num">
            {entries.length > limit
              ? `${visible.length} of ${entries.length}`
              : `${entries.length}`}
          </span>
        </div>
        {err && (
          <p className="rounded bg-deficit/10 px-2 py-1 text-xs text-deficit">
            {err}
          </p>
        )}
        <ul className="divide-y divide-border-subtle">
          {visible.map((e) => {
            const acct = e.account_id ? accountsById[e.account_id] : null;
            const date = e.received_date ?? e.expected_date ?? e.created_at;
            const busy = busyId === e.id;
            return (
              <li
                key={e.id}
                className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {e.source || "Unspecified source"}
                    </span>
                    <span className="rounded bg-card-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                      {INCOME_CATEGORY_LABELS[e.category]}
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
      </Card>

      <AddIncomeDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing}
        accounts={accounts}
        availableBooks={availableBooks}
      />
    </>
  );
}
