"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatShortDate } from "@/lib/format";
import {
  DISTRIBUTION_CADENCES,
  type Book,
  type DistributionCadence,
  type DistributionSchedule,
} from "@/lib/types";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

const CADENCE_LABELS: Record<DistributionCadence, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semimonthly: "Semimonthly",
  monthly: "Monthly",
  custom: "Custom days",
};

const BOOK_LABELS: Record<Book, string> = {
  personal: "Personal",
  business: "Business",
  nonprofit: "Nonprofit",
};

const inputCls =
  "w-full rounded-md border border-border-subtle bg-card px-3 py-2 text-sm";

interface DraftState {
  id: string | null;
  source_book: Book;
  target_book: Book;
  amount: string;
  cadence: DistributionCadence;
  anchor_date: string;
  custom_days: string;
  notes: string;
  is_active: boolean;
}

function emptyDraft(): DraftState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: null,
    source_book: "business",
    target_book: "personal",
    amount: "",
    cadence: "monthly",
    anchor_date: today,
    custom_days: "",
    notes: "",
    is_active: true,
  };
}

function draftFromSchedule(s: DistributionSchedule): DraftState {
  return {
    id: s.id,
    source_book: s.source_book,
    target_book: s.target_book,
    amount: String(s.amount),
    cadence: s.cadence,
    anchor_date: s.anchor_date,
    custom_days: (s.custom_days ?? []).join(","),
    notes: s.notes ?? "",
    is_active: s.is_active,
  };
}

export function DistributionScheduleManager() {
  const [schedules, setSchedules] = useState<DistributionSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (includeInactive) params.set("include_inactive", "true");
      const res = await fetch(
        `/api/distribution-schedules?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load schedules");
      const body = (await res.json()) as { schedules: DistributionSchedule[] };
      setSchedules(body.schedules ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  function openNew() {
    setDraft(emptyDraft());
    setDialogOpen(true);
  }

  function openEdit(s: DistributionSchedule) {
    setDraft(draftFromSchedule(s));
    setDialogOpen(true);
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const amount = Number(draft.amount);
      if (!(amount > 0)) throw new Error("Amount must be positive");
      if (draft.source_book === draft.target_book)
        throw new Error("Source and target must differ");
      const customDays =
        draft.cadence === "custom"
          ? draft.custom_days
              .split(",")
              .map((x) => Number(x.trim()))
              .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
          : null;
      if (draft.cadence === "custom" && (!customDays || customDays.length === 0))
        throw new Error("Custom cadence requires at least one day (1-31)");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.anchor_date))
        throw new Error("Anchor date must be YYYY-MM-DD");

      const payload = {
        source_book: draft.source_book,
        target_book: draft.target_book,
        amount,
        cadence: draft.cadence,
        anchor_date: draft.anchor_date,
        custom_days: customDays,
        notes: draft.notes.trim() || null,
        is_active: draft.is_active,
      };
      const url = draft.id
        ? `/api/distribution-schedules/${draft.id}`
        : "/api/distribution-schedules";
      const method = draft.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to save schedule");
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(s: DistributionSchedule) {
    if (
      !window.confirm(
        `Deactivate distribution schedule for ${formatCurrency(
          Number(s.amount)
        )} ${CADENCE_LABELS[s.cadence].toLowerCase()}? Future projections will be removed.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/distribution-schedules/${s.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Deactivate failed");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function toggleActive(s: DistributionSchedule) {
    try {
      const res = await fetch(`/api/distribution-schedules/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !s.is_active }),
      });
      if (!res.ok) throw new Error("Toggle failed");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Distribution Schedule
          </h3>
          <p className="text-xs text-muted">
            Recurring owner distributions from business to personal (or other
            books). Feeds projected income.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
          >
            <Plus className="h-3 w-3" /> Add Schedule
          </button>
        </div>
      </div>

      {err && (
        <p className="rounded bg-deficit/10 px-2 py-1 text-xs text-deficit">
          {err}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded bg-border-subtle/40"
            />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <p className="rounded border border-dashed border-border-subtle px-3 py-6 text-center text-xs text-muted">
          No schedules yet. Add one to forecast owner distributions forward.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground num">
                    {formatCurrency(Number(s.amount))}
                  </span>
                  <span className="text-xs text-muted">
                    {BOOK_LABELS[s.source_book]} → {BOOK_LABELS[s.target_book]}
                  </span>
                  <span className="rounded bg-border-subtle/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                    {CADENCE_LABELS[s.cadence]}
                  </span>
                  {!s.is_active && (
                    <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Starting {formatShortDate(s.anchor_date)}
                  {s.cadence === "custom" && s.custom_days?.length
                    ? ` · Days ${s.custom_days.join(", ")}`
                    : ""}
                  {s.notes ? ` · ${s.notes}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleActive(s)}
                  title={s.is_active ? "Deactivate" : "Reactivate"}
                  className="rounded p-1.5 text-muted hover:text-foreground"
                >
                  <Power className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(s)}
                  title="Edit"
                  className="rounded p-1.5 text-muted hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deactivate(s)}
                  title="Remove"
                  className="rounded p-1.5 text-muted hover:text-deficit"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDialogOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-border-subtle bg-card p-5">
            <h4 className="text-sm font-semibold text-foreground">
              {draft.id ? "Edit schedule" : "New distribution schedule"}
            </h4>

            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-muted">Source book</span>
                  <select
                    value={draft.source_book}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        source_book: e.target.value as Book,
                      }))
                    }
                    className={inputCls}
                  >
                    {BOOKS.map((b) => (
                      <option key={b} value={b}>
                        {BOOK_LABELS[b]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted">Target book</span>
                  <select
                    value={draft.target_book}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        target_book: e.target.value as Book,
                      }))
                    }
                    className={inputCls}
                  >
                    {BOOKS.map((b) => (
                      <option key={b} value={b}>
                        {BOOK_LABELS[b]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs text-muted">Amount (USD)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.amount}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, amount: e.target.value }))
                  }
                  className={inputCls}
                  placeholder="3000.00"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-muted">Cadence</span>
                  <select
                    value={draft.cadence}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        cadence: e.target.value as DistributionCadence,
                      }))
                    }
                    className={inputCls}
                  >
                    {DISTRIBUTION_CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {CADENCE_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted">Anchor date</span>
                  <input
                    type="date"
                    value={draft.anchor_date}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, anchor_date: e.target.value }))
                    }
                    className={inputCls}
                  />
                </label>
              </div>

              {draft.cadence === "custom" && (
                <label className="block space-y-1">
                  <span className="text-xs text-muted">
                    Custom days of month (comma-separated, 1–31)
                  </span>
                  <input
                    type="text"
                    value={draft.custom_days}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, custom_days: e.target.value }))
                    }
                    className={inputCls}
                    placeholder="1, 15"
                  />
                </label>
              )}

              <label className="block space-y-1">
                <span className="text-xs text-muted">Notes</span>
                <input
                  type="text"
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  className={inputCls}
                  placeholder="Monthly LLC draw"
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, is_active: e.target.checked }))
                  }
                />
                Active
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-foreground hover:bg-card-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
              >
                {saving ? "Saving…" : draft.id ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
