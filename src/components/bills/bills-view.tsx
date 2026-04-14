"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleSlash,
  Loader2,
  Pause,
  Pencil,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import type {
  BillRow,
  BillPaymentRow,
  AcctLite,
  CategoryLite,
} from "@/lib/bills/load";
import type { Book } from "@/lib/types";

type Lifecycle = BillRow["lifecycle"];
type Tier = BillRow["priority_tier"];

interface Props {
  book: Book;
  bookLabel: string;
  bills: BillRow[];
  payments: BillPaymentRow[];
  accounts: AcctLite[];
  categories: CategoryLite[];
}

const TIER_META: Record<
  Tier,
  { label: string; accent: "deficit" | "warning" | "muted" }
> = {
  "1": { label: "Critical", accent: "deficit" },
  "2": { label: "Important", accent: "warning" },
  "3": { label: "Discretionary", accent: "muted" },
};

export function BillsView({
  book,
  bookLabel,
  bills,
  payments,
  accounts,
  categories,
}: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BillRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const active = bills.filter((b) => b.lifecycle === "active");
  const paused = bills.filter((b) => b.lifecycle === "paused");
  const cancelled = bills.filter((b) => b.lifecycle === "cancelled");

  const paymentsByBill = useMemo(() => {
    const m = new Map<string, BillPaymentRow[]>();
    for (const p of payments) {
      const arr = m.get(p.bill_id) ?? [];
      arr.push(p);
      m.set(p.bill_id, arr);
    }
    return m;
  }, [payments]);

  const groups = useMemo(() => {
    const g7: BillRow[] = [];
    const g14: BillRow[] = [];
    const g30: BillRow[] = [];
    const later: BillRow[] = [];
    for (const b of active) {
      const days = daysBetween(today, b.due_date);
      if (days <= 7) g7.push(b);
      else if (days <= 14) g14.push(b);
      else if (days <= 30) g30.push(b);
      else later.push(b);
    }
    return { g7, g14, g30, later };
  }, [active, today]);

  const monthlyTotal = useMemo(() => {
    // Approximate monthly obligation: fixed amount (or typical_amount) projected to monthly cadence.
    let total = 0;
    for (const b of active) {
      const base = Number(b.variable ? b.typical_amount ?? 0 : b.amount ?? 0);
      if (!base) continue;
      switch (b.frequency) {
        case "weekly":
          total += base * 4.33;
          break;
        case "quarterly":
          total += base / 3;
          break;
        case "yearly":
          total += base / 12;
          break;
        default:
          total += base;
      }
    }
    return total;
  }, [active]);

  async function lifecycle(bill: BillRow, next: Lifecycle) {
    setBusyId(bill.id);
    try {
      await fetch(`/api/bills/${bill.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: next }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(bill: BillRow) {
    const pCount = paymentsByBill.get(bill.id)?.length ?? 0;
    if (
      !confirm(
        `Delete "${bill.name}"? This also removes ${pCount} payment${pCount === 1 ? "" : "s"} from history.`
      )
    )
      return;
    setBusyId(bill.id);
    try {
      await fetch(`/api/bills/${bill.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function markPaid(bill: BillRow) {
    const amt = prompt(
      `Amount paid for "${bill.name}"?`,
      String(bill.amount ?? bill.typical_amount ?? "0.00")
    );
    if (amt === null) return;
    const amount = Number(amt);
    if (!(amount > 0)) return;
    setBusyId(bill.id);
    try {
      const res = await fetch(`/api/bills/${bill.id}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_paid: amount,
          manual: true,
          date_paid: new Date().toISOString().slice(0, 10),
        }),
      });
      if (!res.ok) {
        setToast("Mark-paid failed");
      } else {
        setToast(`Marked "${bill.name}" paid`);
      }
      router.refresh();
    } finally {
      setBusyId(null);
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="has-bottom-nav space-y-5 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-sm">{bookLabel}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Bills</h1>
          <p className="text-xs text-muted">
            {active.length} active · approx {formatCurrency(monthlyTotal)}/mo
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> Add bill
        </button>
      </header>

      {active.length === 0 && !adding && (
        <Card>
          <div className="text-center">
            <Sparkles className="mx-auto mb-2 h-5 w-5 text-terracotta" />
            <p className="font-medium">No bills yet</p>
            <p className="mt-1 text-sm text-muted">
              Add fixed obligations (mortgage, phone, insurance) and HO3 will
              auto-mark them paid when matching Plaid transactions land.
            </p>
            <button
              onClick={() => setAdding(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white"
            >
              <Plus className="h-3 w-3" /> Add first bill
            </button>
          </div>
        </Card>
      )}

      <Section title="Next 7 days" bills={groups.g7} onEdit={setEditing} onMarkPaid={markPaid} onLifecycle={lifecycle} onRemove={remove} busyId={busyId} accounts={accounts} paymentsByBill={paymentsByBill} />
      <Section title="Next 14 days" bills={groups.g14} onEdit={setEditing} onMarkPaid={markPaid} onLifecycle={lifecycle} onRemove={remove} busyId={busyId} accounts={accounts} paymentsByBill={paymentsByBill} />
      <Section title="Next 30 days" bills={groups.g30} onEdit={setEditing} onMarkPaid={markPaid} onLifecycle={lifecycle} onRemove={remove} busyId={busyId} accounts={accounts} paymentsByBill={paymentsByBill} />
      <Section title="Later" bills={groups.later} onEdit={setEditing} onMarkPaid={markPaid} onLifecycle={lifecycle} onRemove={remove} busyId={busyId} accounts={accounts} paymentsByBill={paymentsByBill} />

      {paused.length > 0 && (
        <Section title="Paused" bills={paused} onEdit={setEditing} onMarkPaid={markPaid} onLifecycle={lifecycle} onRemove={remove} busyId={busyId} accounts={accounts} paymentsByBill={paymentsByBill} paused />
      )}
      {cancelled.length > 0 && (
        <Section title="Cancelled" bills={cancelled} onEdit={setEditing} onMarkPaid={markPaid} onLifecycle={lifecycle} onRemove={remove} busyId={busyId} accounts={accounts} paymentsByBill={paymentsByBill} paused />
      )}

      {(adding || editing) && (
        <BillForm
          book={book}
          accounts={accounts}
          categories={categories}
          bill={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function Section({
  title,
  bills,
  onEdit,
  onMarkPaid,
  onLifecycle,
  onRemove,
  busyId,
  accounts,
  paymentsByBill,
  paused = false,
}: {
  title: string;
  bills: BillRow[];
  onEdit: (b: BillRow) => void;
  onMarkPaid: (b: BillRow) => void;
  onLifecycle: (b: BillRow, l: Lifecycle) => void;
  onRemove: (b: BillRow) => void;
  busyId: string | null;
  accounts: AcctLite[];
  paymentsByBill: Map<string, BillPaymentRow[]>;
  paused?: boolean;
}) {
  if (bills.length === 0) return null;
  const sum = bills.reduce(
    (s, b) =>
      s + Number(b.variable ? b.typical_amount ?? 0 : b.amount ?? 0),
    0
  );
  return (
    <section className={paused ? "opacity-70" : ""}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="label-sm">{title}</h2>
        <span className="num text-xs text-muted">
          {bills.length} · {formatCurrency(sum)}
        </span>
      </div>
      <div className="space-y-2">
        {bills.map((b) => (
          <BillCard
            key={b.id}
            bill={b}
            account={accounts.find((a) => a.id === b.account_id) || null}
            payments={paymentsByBill.get(b.id) ?? []}
            onEdit={() => onEdit(b)}
            onMarkPaid={() => onMarkPaid(b)}
            onLifecycle={(l) => onLifecycle(b, l)}
            onRemove={() => onRemove(b)}
            busy={busyId === b.id}
          />
        ))}
      </div>
    </section>
  );
}

function BillCard({
  bill,
  account,
  payments,
  onEdit,
  onMarkPaid,
  onLifecycle,
  onRemove,
  busy,
}: {
  bill: BillRow;
  account: AcctLite | null;
  payments: BillPaymentRow[];
  onEdit: () => void;
  onMarkPaid: () => void;
  onLifecycle: (l: Lifecycle) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const tier = TIER_META[bill.priority_tier];
  const today = new Date().toISOString().slice(0, 10);
  const days = daysBetween(today, bill.due_date);
  const overdue = days < 0;
  const amt = bill.variable
    ? bill.typical_amount ?? bill.amount
    : bill.amount;
  const lastPayment = payments[0];
  return (
    <Card
      accent={tier.accent === "muted" ? "none" : tier.accent}
      className="flex flex-wrap items-start justify-between gap-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{bill.name}</p>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              tier.accent === "deficit"
                ? "bg-deficit/10 text-deficit"
                : tier.accent === "warning"
                  ? "bg-warning/10 text-warning"
                  : "bg-card-hover text-muted"
            }`}
          >
            {tier.label}
          </span>
          {bill.autopay && (
            <span className="inline-flex items-center gap-0.5 rounded bg-accent-blue/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-blue">
              <Zap className="h-2.5 w-2.5" /> Autopay
            </span>
          )}
          {bill.variable && (
            <span className="rounded bg-card-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              Variable
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          Due {formatDate(bill.due_date)}{" "}
          {bill.lifecycle === "active" && (
            <span className={overdue ? "text-deficit" : undefined}>
              {overdue
                ? `· ${Math.abs(days)}d overdue`
                : days === 0
                  ? "· today"
                  : `· ${days}d`}
            </span>
          )}
          {bill.frequency && <> · {bill.frequency}</>}
          {account && (
            <>
              {" "}· {account.name}
              {account.mask && <span className="ml-0.5">••{account.mask}</span>}
            </>
          )}
        </p>
        {bill.notes && (
          <p className="mt-1 text-xs text-muted italic">{bill.notes}</p>
        )}
        {lastPayment && (
          <p className="mt-1 text-xs text-muted">
            Last paid {formatDate(lastPayment.date_paid)} ·{" "}
            {formatCurrency(Number(lastPayment.amount_paid))}
            {lastPayment.manual ? "" : " (auto)"}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <p className="num text-lg font-semibold">
          {amt ? formatCurrency(Number(amt)) : "—"}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {bill.lifecycle === "active" && (
            <button
              onClick={onMarkPaid}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-surplus/40 bg-surplus/10 px-2 py-1 text-xs font-medium text-surplus disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Mark paid
            </button>
          )}
          <button
            onClick={onEdit}
            className="rounded-lg border border-border-subtle p-1 text-muted hover:text-foreground"
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
          {bill.lifecycle === "active" ? (
            <button
              onClick={() => onLifecycle("paused")}
              className="rounded-lg border border-border-subtle p-1 text-muted hover:text-warning"
              title="Pause"
            >
              <Pause className="h-3 w-3" />
            </button>
          ) : bill.lifecycle === "paused" ? (
            <button
              onClick={() => onLifecycle("active")}
              className="rounded-lg border border-border-subtle p-1 text-muted hover:text-foreground"
              title="Resume"
            >
              <RotateCw className="h-3 w-3" />
            </button>
          ) : null}
          {bill.lifecycle !== "cancelled" && (
            <button
              onClick={() => onLifecycle("cancelled")}
              className="rounded-lg border border-border-subtle p-1 text-muted hover:text-deficit"
              title="Cancel"
            >
              <CircleSlash className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={onRemove}
            className="rounded-lg border border-deficit/30 p-1 text-deficit hover:bg-deficit/10"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {payments.length > 0 && (
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-xs text-muted hover:text-foreground"
          >
            {historyOpen ? "Hide" : "History"} ({payments.length})
          </button>
        )}
      </div>

      {historyOpen && (
        <ul className="w-full border-t border-border-subtle pt-2 text-xs">
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between py-0.5"
            >
              <span className="text-muted">
                {formatDate(p.date_paid)} ·{" "}
                {p.manual ? "manual" : "auto-matched"}
                {p.note && ` · ${p.note}`}
              </span>
              <span className="num font-medium">
                {formatCurrency(Number(p.amount_paid))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BillForm({
  book,
  accounts,
  categories,
  bill,
  onClose,
  onSaved,
}: {
  book: Book;
  accounts: AcctLite[];
  categories: CategoryLite[];
  bill: BillRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<{
    name: string;
    biller: string;
    variable: boolean;
    amount: string;
    typical_amount: string;
    due_date: string;
    due_day: string;
    is_recurring: boolean;
    frequency: "weekly" | "monthly" | "quarterly" | "yearly" | "";
    account_id: string;
    category_id: string;
    autopay: boolean;
    priority_tier: Tier;
    notes: string;
  }>({
    name: bill?.name ?? "",
    biller: bill?.biller ?? "",
    variable: bill?.variable ?? false,
    amount:
      bill?.amount !== null && bill?.amount !== undefined ? String(bill.amount) : "",
    typical_amount:
      bill?.typical_amount !== null && bill?.typical_amount !== undefined
        ? String(bill.typical_amount)
        : "",
    due_date: bill?.due_date ?? new Date().toISOString().slice(0, 10),
    due_day: bill?.due_day ? String(bill.due_day) : "",
    is_recurring: bill?.is_recurring ?? true,
    frequency: (bill?.frequency ?? "monthly") as
      | "weekly"
      | "monthly"
      | "quarterly"
      | "yearly"
      | "",
    account_id: bill?.account_id ?? "",
    category_id: bill?.category_id ?? "",
    autopay: bill?.autopay ?? false,
    priority_tier: (bill?.priority_tier ?? "2") as Tier,
    notes: bill?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const payload = {
        book,
        name: form.name.trim(),
        biller: form.biller.trim() || null,
        variable: form.variable,
        amount: form.variable ? null : form.amount ? Number(form.amount) : null,
        typical_amount: form.typical_amount
          ? Number(form.typical_amount)
          : null,
        due_date: form.due_date,
        due_day: form.due_day ? Number(form.due_day) : null,
        is_recurring: form.is_recurring,
        frequency: form.is_recurring ? form.frequency || "monthly" : null,
        account_id: form.account_id || null,
        category_id: form.category_id || null,
        autopay: form.autopay,
        priority_tier: form.priority_tier,
        notes: form.notes.trim() || null,
      };
      const res = bill
        ? await fetch(`/api/bills/${bill.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/bills`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Save failed");
      }
      onSaved();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
            {bill ? "Edit bill" : "New bill"}
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
          <Field label="Name" required>
            <input
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field
            label="Biller (merchant name)"
            hint="Used to auto-match transactions. Leave blank if Plaid merchant already matches the name."
          >
            <input
              value={form.biller}
              onChange={(e) => set("biller", e.target.value)}
              className={inputCls}
              placeholder="e.g. USAA FEDERAL"
            />
          </Field>

          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={form.variable}
              onChange={(e) => set("variable", e.target.checked)}
            />
            Variable amount (changes month-to-month)
          </label>

          {form.variable ? (
            <Field label="Typical amount">
              <input
                type="number"
                step="0.01"
                value={form.typical_amount}
                onChange={(e) => set("typical_amount", e.target.value)}
                className={inputCls}
                placeholder="0.00"
              />
            </Field>
          ) : (
            <Field label="Amount" required>
              <input
                required
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                className={inputCls}
                placeholder="0.00"
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Next due date" required>
              <input
                required
                type="date"
                value={form.due_date}
                onChange={(e) => set("due_date", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Priority">
              <select
                value={form.priority_tier}
                onChange={(e) => set("priority_tier", e.target.value as Tier)}
                className={inputCls}
              >
                <option value="1">Critical</option>
                <option value="2">Important</option>
                <option value="3">Discretionary</option>
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={form.is_recurring}
              onChange={(e) => set("is_recurring", e.target.checked)}
            />
            Recurring
          </label>

          {form.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Frequency">
                <select
                  value={form.frequency}
                  onChange={(e) =>
                    set(
                      "frequency",
                      e.target.value as
                        | "weekly"
                        | "monthly"
                        | "quarterly"
                        | "yearly"
                    )
                  }
                  className={inputCls}
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </Field>
              <Field label="Preferred day of month">
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={form.due_day}
                  onChange={(e) => set("due_day", e.target.value)}
                  className={inputCls}
                  placeholder="(optional)"
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid from account">
              <select
                value={form.account_id}
                onChange={(e) => set("account_id", e.target.value)}
                className={inputCls}
              >
                <option value="">(any)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.mask ? ` ••${a.mask}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={form.category_id}
                onChange={(e) => set("category_id", e.target.value)}
                className={inputCls}
              >
                <option value="">(none)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={form.autopay}
              onChange={(e) => set("autopay", e.target.checked)}
            />
            Autopay enabled
          </label>

          <Field label="Notes">
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                set("notes", e.target.value)
              }
              className={inputCls}
            />
          </Field>
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
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {bill ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5 text-sm";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label-sm">
        {label}
        {required && <span className="ml-1 text-deficit">*</span>}
      </label>
      {children}
      {hint && <p className="mt-0.5 text-[10px] text-muted">{hint}</p>}
    </div>
  );
}

function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((tb - ta) / 86_400_000);
}
