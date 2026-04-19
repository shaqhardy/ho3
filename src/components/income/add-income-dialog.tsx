"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import {
  INCOME_CATEGORIES,
  INCOME_CATEGORY_LABELS,
  type Book,
  type IncomeCategory,
  type IncomeEntry,
} from "@/lib/types";
import { BOOK_LABELS } from "@/lib/books";

export interface IncomeDialogAccount {
  id: string;
  name: string;
  mask: string | null;
  book: Book;
}

export interface IncomeDialogDefaults {
  book?: Book;
  accountId?: string | null;
  amount?: number | string;
  source?: string | null;
  category?: IncomeCategory;
  receivedDate?: string;
  linkedPlanItemId?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (entry: IncomeEntry) => void;
  accounts: IncomeDialogAccount[];
  availableBooks: Book[];
  defaults?: IncomeDialogDefaults;
  editing?: IncomeEntry | null;
}

const inputCls =
  "mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5 text-sm";

export function AddIncomeDialog({
  open,
  onClose,
  onSaved,
  accounts,
  availableBooks,
  defaults,
  editing,
}: Props) {
  const router = useRouter();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const initialBook =
    (editing?.book as Book | undefined) ??
    defaults?.book ??
    availableBooks[0] ??
    ("personal" as Book);

  const [form, setForm] = useState(() => ({
    book: initialBook,
    account_id:
      editing?.account_id ?? defaults?.accountId ?? ("" as string | null),
    amount:
      editing?.amount !== undefined && editing?.amount !== null
        ? String(editing.amount)
        : defaults?.amount !== undefined
          ? String(defaults.amount)
          : "",
    received_date: editing?.received_date ?? defaults?.receivedDate ?? today,
    source: editing?.source ?? defaults?.source ?? "",
    category:
      (editing?.category as IncomeCategory | undefined) ??
      defaults?.category ??
      "other",
    notes: editing?.notes ?? "",
    linked_plan_item_id:
      editing?.linked_plan_item_id ?? defaults?.linkedPlanItemId ?? null,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/income/sources?book=${encodeURIComponent(form.book)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = (await res.json()) as { sources?: string[] };
        if (!aborted) setSources(json.sources ?? []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      aborted = true;
    };
  }, [open, form.book]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const accountsForBook = accounts.filter((a) => a.book === form.book);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const amountNum = Number(form.amount);
    if (!(amountNum > 0)) {
      setErr("Amount must be positive");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        book: form.book,
        account_id: form.account_id || null,
        amount: amountNum,
        received_date: form.received_date || null,
        source: form.source.trim() || null,
        category: form.category,
        notes: form.notes.trim() || null,
        linked_plan_item_id: form.linked_plan_item_id,
      };
      const res = editing
        ? await fetch(`/api/income/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/income", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Save failed");
      }
      const body = (await res.json()) as { entry: IncomeEntry };
      onSaved?.(body.entry);
      onClose();
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {editing ? "Edit income" : "Add income"}
          </h2>
          <button type="button" onClick={onClose} className="text-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {err && (
          <p className="mb-2 rounded bg-deficit/10 px-2 py-1 text-xs text-deficit">
            {err}
          </p>
        )}

        <div className="space-y-3 text-sm">
          <div>
            <label className="label-sm">
              Book<span className="ml-1 text-deficit">*</span>
            </label>
            <select
              value={form.book}
              onChange={(e) => {
                const b = e.target.value as Book;
                set("book", b);
                // Reset account — accounts are book-scoped.
                set("account_id", "");
              }}
              className={inputCls}
              disabled={!!editing}
            >
              {availableBooks.map((b) => (
                <option key={b} value={b}>
                  {BOOK_LABELS[b]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-sm">Account</label>
            <select
              value={form.account_id ?? ""}
              onChange={(e) => set("account_id", e.target.value || null)}
              className={inputCls}
            >
              <option value="">— Unspecified —</option>
              {accountsForBook.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.mask ? ` ••${a.mask}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">
                Amount<span className="ml-1 text-deficit">*</span>
              </label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                className={inputCls}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="label-sm">
                Received<span className="ml-1 text-deficit">*</span>
              </label>
              <input
                required
                type="date"
                value={form.received_date}
                onChange={(e) => set("received_date", e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="label-sm">Source</label>
            <input
              list="income-sources"
              value={form.source}
              onChange={(e) => set("source", e.target.value)}
              className={inputCls}
              placeholder="Who paid you? (client, church, platform)"
            />
            <datalist id="income-sources">
              {sources.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="label-sm">Category</label>
            <select
              value={form.category}
              onChange={(e) =>
                set("category", e.target.value as IncomeCategory)
              }
              className={inputCls}
            >
              {INCOME_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {INCOME_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-sm">Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              className={inputCls}
              placeholder="Invoice #, memo, reference"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            {editing ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}
