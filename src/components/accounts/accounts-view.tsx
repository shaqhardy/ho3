"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import {
  AlertTriangle,
  Building2,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { Card, ElevatedCard } from "@/components/ui/card";
import { PlaidLinkButton } from "@/components/plaid-link-button";
import { formatCurrency } from "@/lib/format";
import { isLiability, signedNetWorthBalance } from "@/lib/accounts/money";

type Book = "personal" | "business" | "nonprofit";

interface PlaidItemRow {
  id: string;
  plaid_item_id: string;
  institution_name: string | null;
  needs_reauth: boolean;
  last_error: string | null;
  last_error_at: string | null;
  pending_delete_id: string | null;
  created_at: string;
}

interface AccountRow {
  id: string;
  book: Book;
  name: string;
  nickname: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  current_balance: number | string;
  available_balance: number | string | null;
  last_synced_at: string | null;
  plaid_item_id: string | null;
  is_hidden: boolean;
  pending_delete_id: string | null;
}

interface Props {
  isAdmin: boolean;
  allowedBooks: Book[];
  items: PlaidItemRow[];
  accounts: AccountRow[];
}

type PendingToast = {
  id: string;
  kind: "account" | "bank";
  label: string;
  countsLine: string;
  pendingDeletionId: string;
  scheduledAt: number;
};

const BOOK_LABELS: Record<Book, string> = {
  personal: "Personal",
  business: "Business",
  nonprofit: "Nonprofit",
};

const BOOK_ORDER: Book[] = ["personal", "business", "nonprofit"];

export function AccountsView({ isAdmin, allowedBooks, items, accounts }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Array<{
    id: string;
    kind: "success" | "error" | "info";
    message: string;
  }>>([]);
  const [pending, setPending] = useState<PendingToast[]>([]);
  const [confirm, setConfirm] = useState<null | {
    title: string;
    body: ReactNode;
    onConfirm: () => void;
  }>(null);
  const [reconnectItem, setReconnectItem] = useState<{
    id: string;
    token: string;
  } | null>(null);

  const pushToast = useCallback(
    (kind: "success" | "error" | "info", message: string) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  // --- Pending deletion 30s timer loop -------------------------------------
  const purgedRef = useRef(new Set<string>());
  useEffect(() => {
    if (pending.length === 0) return;
    const tick = setInterval(() => {
      const now = Date.now();
      setPending((prev) => prev.filter((p) => p.scheduledAt > now));
      for (const p of pending) {
        if (p.scheduledAt <= now && !purgedRef.current.has(p.pendingDeletionId)) {
          purgedRef.current.add(p.pendingDeletionId);
          fetch(`/api/pending-deletions/${p.pendingDeletionId}/commit`, {
            method: "POST",
          })
            .then(() => router.refresh())
            .catch(() => {
              /* housekeeping will catch it next load */
            });
        }
      }
    }, 250);
    return () => clearInterval(tick);
  }, [pending, router]);

  // --- Grouping ------------------------------------------------------------
  const banks = useMemo(() => {
    const visibleAccounts = accounts;
    const byPlaidItemId = new Map<string, AccountRow[]>();
    for (const a of visibleAccounts) {
      if (!a.plaid_item_id) continue;
      const arr = byPlaidItemId.get(a.plaid_item_id) ?? [];
      arr.push(a);
      byPlaidItemId.set(a.plaid_item_id, arr);
    }
    return items.map((item) => ({
      item,
      accounts: byPlaidItemId.get(item.plaid_item_id) ?? [],
    }));
  }, [items, accounts]);

  const manualAccounts = useMemo(
    () => accounts.filter((a) => !a.plaid_item_id),
    [accounts]
  );

  // --- Action handlers -----------------------------------------------------
  async function runAction(
    key: string,
    url: string,
    body?: unknown
  ): Promise<Response | null> {
    setBusyId(key);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return res;
    } catch (err) {
      console.error(err);
      pushToast("error", "Network error");
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(acct: AccountRow) {
    const current = acct.nickname ?? "";
    const next = window.prompt(
      `Friendly name for this account (Plaid calls it "${acct.name}"):`,
      current
    );
    if (next === null) return;
    const res = await runAction(
      `rename-${acct.id}`,
      `/api/accounts/${acct.id}/rename`,
      { nickname: next }
    );
    if (res?.ok) {
      pushToast("success", "Renamed");
      router.refresh();
    } else {
      pushToast("error", "Rename failed");
    }
  }

  async function handleReassign(acct: AccountRow, book: Book) {
    const res = await runAction(
      `reassign-${acct.id}`,
      `/api/accounts/${acct.id}/reassign`,
      { book }
    );
    if (res?.ok) {
      pushToast("success", `Moved to ${BOOK_LABELS[book]}`);
      router.refresh();
    } else {
      pushToast("error", "Move failed");
    }
  }

  function confirmDisconnectAccount(acct: AccountRow) {
    const label =
      acct.nickname || `${acct.name}${acct.mask ? ` ••${acct.mask}` : ""}`;
    setConfirm({
      title: "Remove this account?",
      body: (
        <>
          <p>
            <strong>{label}</strong> will be removed from {BOOK_LABELS[acct.book]} and
            its transaction history deleted. You&rsquo;ll have 30 seconds to undo.
          </p>
          <p className="mt-2 text-muted">
            The rest of the bank connection stays live.
          </p>
        </>
      ),
      onConfirm: async () => {
        setConfirm(null);
        const res = await runAction(
          `disc-acct-${acct.id}`,
          `/api/accounts/${acct.id}/disconnect`
        );
        if (!res?.ok) {
          pushToast("error", "Failed to remove account");
          return;
        }
        const data = (await res.json()) as {
          pending_deletion_id: string;
          txn_count: number;
        };
        setPending((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            kind: "account",
            label,
            countsLine: `${data.txn_count} transaction${data.txn_count === 1 ? "" : "s"}`,
            pendingDeletionId: data.pending_deletion_id,
            scheduledAt: Date.now() + 30_000,
          },
        ]);
        router.refresh();
      },
    });
  }

  function confirmDisconnectBank(
    item: PlaidItemRow,
    bankAccounts: AccountRow[]
  ) {
    setConfirm({
      title: `Disconnect ${item.institution_name || "this bank"}?`,
      body: (
        <>
          <p>
            This revokes the Plaid connection and deletes{" "}
            <strong>{bankAccounts.length}</strong>{" "}
            {bankAccounts.length === 1 ? "account" : "accounts"} plus all
            associated transactions and liabilities.
          </p>
          <p className="mt-2">
            You&rsquo;ll have 30 seconds to undo. After that, the Plaid access
            token is revoked — you&rsquo;ll have to re-link the bank from scratch.
          </p>
        </>
      ),
      onConfirm: async () => {
        setConfirm(null);
        const res = await runAction(
          `disc-item-${item.id}`,
          `/api/plaid/items/${item.id}/disconnect`
        );
        if (!res?.ok) {
          pushToast("error", "Failed to disconnect bank");
          return;
        }
        const data = (await res.json()) as {
          pending_deletion_id: string;
          account_count: number;
          txn_count: number;
        };
        setPending((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            kind: "bank",
            label: item.institution_name || "Bank",
            countsLine: `${data.account_count} account${data.account_count === 1 ? "" : "s"} • ${data.txn_count} transaction${data.txn_count === 1 ? "" : "s"}`,
            pendingDeletionId: data.pending_deletion_id,
            scheduledAt: Date.now() + 30_000,
          },
        ]);
        router.refresh();
      },
    });
  }

  async function handleUndo(p: PendingToast) {
    const res = await fetch(
      `/api/pending-deletions/${p.pendingDeletionId}/undo`,
      { method: "POST" }
    );
    if (res.ok) {
      purgedRef.current.add(p.pendingDeletionId);
      setPending((prev) =>
        prev.filter((x) => x.pendingDeletionId !== p.pendingDeletionId)
      );
      pushToast("success", `Restored ${p.label}`);
      router.refresh();
    } else {
      pushToast("error", "Undo failed");
    }
  }

  async function handleSync(item: PlaidItemRow) {
    const res = await runAction(
      `sync-${item.id}`,
      `/api/plaid/items/${item.id}/sync`
    );
    if (!res) return;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      pushToast("error", body.error || "Sync failed");
      return;
    }
    const data = (await res.json()) as {
      added: number;
      modified: number;
      balances_refreshed: number;
    };
    pushToast(
      "success",
      `Synced ${data.balances_refreshed} balance${data.balances_refreshed === 1 ? "" : "s"} • ${data.added} new txn${data.added === 1 ? "" : "s"}`
    );
    router.refresh();
  }

  async function handleReconnect(item: PlaidItemRow) {
    const res = await runAction(
      `reconn-${item.id}`,
      `/api/plaid/items/${item.id}/update-link-token`
    );
    if (!res?.ok) {
      pushToast("error", "Couldn't start reconnect");
      return;
    }
    const { link_token } = (await res.json()) as { link_token: string };
    setReconnectItem({ id: item.id, token: link_token });
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <Card>
          <p className="text-muted">
            Account management is admin-only. Ask the admin on this household to
            link or disconnect banks.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted">
            Manage connected banks, reassign accounts between books, and
            disconnect what you don&rsquo;t want tracked.
          </p>
        </div>
        <PlaidLinkButton />
      </header>

      {banks.length === 0 && manualAccounts.length === 0 && (
        <ElevatedCard accent="terracotta">
          <div className="flex flex-col items-start gap-3">
            <div className="rounded-lg bg-terracotta/10 p-3 text-terracotta">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No banks connected yet</h2>
              <p className="mt-1 text-sm text-muted">
                Connect your first bank to start pulling transactions into the
                Personal, Business, or Nonprofit book.
              </p>
            </div>
            <PlaidLinkButton />
          </div>
        </ElevatedCard>
      )}

      {banks.map(({ item, accounts: bankAccounts }) => {
        // Net contribution of the bank (assets here minus liabilities here).
        const bankNetWorth = bankAccounts.reduce(
          (sum, a) => sum + signedNetWorthBalance(a),
          0
        );
        const bankOwed = bankAccounts
          .filter((a) => isLiability(a.type))
          .reduce((sum, a) => sum + Number(a.current_balance || 0), 0);
        const pendingDelete = !!item.pending_delete_id;
        const status = pendingDelete
          ? "pending"
          : item.needs_reauth
            ? "reauth"
            : "healthy";
        return (
          <Card
            key={item.id}
            accent={
              status === "reauth"
                ? "warning"
                : status === "pending"
                  ? "deficit"
                  : "terracotta"
            }
            className={pendingDelete ? "opacity-60" : ""}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-terracotta/10 p-2.5 text-terracotta">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">
                    {item.institution_name || "Unnamed bank"}
                  </h2>
                  <p className="text-xs text-muted">
                    {bankAccounts.length} account
                    {bankAccounts.length === 1 ? "" : "s"} •{" "}
                    <span
                      className={
                        bankNetWorth < 0 ? "text-deficit" : undefined
                      }
                    >
                      {formatCurrency(bankNetWorth)} net
                    </span>
                    {bankOwed > 0 && (
                      <>
                        {" • "}
                        <span className="text-deficit">
                          {formatCurrency(bankOwed)} owed
                        </span>
                      </>
                    )}
                  </p>
                  <StatusPill status={status} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {item.needs_reauth && (
                  <button
                    onClick={() => handleReconnect(item)}
                    disabled={busyId === `reconn-${item.id}` || pendingDelete}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reconnect
                  </button>
                )}
                <button
                  onClick={() => handleSync(item)}
                  disabled={busyId === `sync-${item.id}` || pendingDelete}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-muted transition hover:border-border hover:text-foreground disabled:opacity-50"
                >
                  {busyId === `sync-${item.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sync now
                </button>
                <button
                  onClick={() => confirmDisconnectBank(item, bankAccounts)}
                  disabled={pendingDelete}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-deficit/30 bg-transparent px-3 py-1.5 text-xs font-medium text-deficit transition hover:bg-deficit/10 disabled:opacity-50"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </div>
            </div>

            <div className="mt-4 divide-y divide-border-subtle border-t border-border-subtle">
              {bankAccounts.length === 0 && (
                <p className="py-4 text-sm text-muted">
                  No accounts under this connection.
                </p>
              )}
              {bankAccounts.map((acct) => (
                <AccountRowView
                  key={acct.id}
                  acct={acct}
                  allowedBooks={allowedBooks}
                  busyId={busyId}
                  onRename={handleRename}
                  onReassign={handleReassign}
                  onDisconnect={confirmDisconnectAccount}
                  bankPending={pendingDelete}
                />
              ))}
            </div>
          </Card>
        );
      })}

      {manualAccounts.length > 0 && (
        <Card>
          <h2 className="text-base font-semibold">Unlinked accounts</h2>
          <p className="mb-3 text-xs text-muted">
            Accounts not tied to a Plaid connection.
          </p>
          <div className="divide-y divide-border-subtle border-t border-border-subtle">
            {manualAccounts.map((acct) => (
              <AccountRowView
                key={acct.id}
                acct={acct}
                allowedBooks={allowedBooks}
                busyId={busyId}
                onRename={handleRename}
                onReassign={handleReassign}
                onDisconnect={confirmDisconnectAccount}
                bankPending={false}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          onClose={() => setConfirm(null)}
          onConfirm={confirm.onConfirm}
        >
          {confirm.body}
        </ConfirmDialog>
      )}

      {/* Plaid reconnect (update mode) */}
      {reconnectItem && (
        <ReconnectLinkLauncher
          itemId={reconnectItem.id}
          token={reconnectItem.token}
          onDone={() => {
            setReconnectItem(null);
            pushToast("success", "Bank reconnected");
            router.refresh();
          }}
          onExit={() => setReconnectItem(null)}
        />
      )}

      {/* Undo toast stack */}
      <div className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {pending.map((p) => (
          <UndoToast key={p.id} pending={p} onUndo={handleUndo} />
        ))}
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
              t.kind === "error"
                ? "border-deficit/30 bg-deficit/10 text-deficit"
                : t.kind === "success"
                  ? "border-surplus/30 bg-surplus/10 text-surplus"
                  : "border-border-subtle bg-card text-foreground"
            }`}
          >
            {t.kind === "success" ? (
              <Check className="h-4 w-4" />
            ) : t.kind === "error" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : null}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function AccountRowView({
  acct,
  allowedBooks,
  busyId,
  onRename,
  onReassign,
  onDisconnect,
  bankPending,
}: {
  acct: AccountRow;
  allowedBooks: Book[];
  busyId: string | null;
  onRename: (a: AccountRow) => void;
  onReassign: (a: AccountRow, b: Book) => void;
  onDisconnect: (a: AccountRow) => void;
  bankPending: boolean;
}) {
  const pending = !!acct.pending_delete_id;
  const label = acct.nickname || acct.name;
  const books = BOOK_ORDER.filter(
    (b) => allowedBooks.includes(b) || b === acct.book
  );
  const balance = Number(acct.current_balance || 0);
  const liability = isLiability(acct.type);
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 py-3 ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">
            {label}
            {acct.mask && (
              <span className="ml-1 text-xs font-normal text-muted">
                ••{acct.mask}
              </span>
            )}
          </p>
          {acct.nickname && (
            <span className="rounded bg-terracotta/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-terracotta">
              Renamed
            </span>
          )}
          {pending && (
            <span className="rounded bg-deficit/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-deficit">
              Pending delete
            </span>
          )}
        </div>
        <p className="text-xs text-muted">
          {subtypeLabel(acct)} •{" "}
          {liability ? (
            <span className="num text-deficit font-medium">
              Owed: {formatCurrency(balance)}
            </span>
          ) : (
            <span className="num">{formatCurrency(balance)}</span>
          )}
          {acct.last_synced_at && (
            <> • synced {timeAgo(acct.last_synced_at)}</>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`book-${acct.id}`}>
          Book
        </label>
        <select
          id={`book-${acct.id}`}
          value={acct.book}
          disabled={pending || bankPending || busyId === `reassign-${acct.id}`}
          onChange={(e) => onReassign(acct, e.target.value as Book)}
          className="rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-xs disabled:opacity-50"
        >
          {books.map((b) => (
            <option key={b} value={b}>
              {BOOK_LABELS[b]}
            </option>
          ))}
        </select>
        <button
          onClick={() => onRename(acct)}
          disabled={pending || bankPending}
          title="Rename"
          className="rounded-lg border border-border-subtle p-1.5 text-muted transition hover:text-foreground disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDisconnect(acct)}
          disabled={pending || bankPending}
          title="Remove this account"
          className="rounded-lg border border-deficit/30 p-1.5 text-deficit transition hover:bg-deficit/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "healthy" | "reauth" | "pending" }) {
  const spec =
    status === "healthy"
      ? { label: "Healthy", cls: "bg-surplus/10 text-surplus" }
      : status === "reauth"
        ? {
            label: "Needs reconnection",
            cls: "bg-warning/10 text-warning",
          }
        : { label: "Disconnecting…", cls: "bg-deficit/10 text-deficit" };
  return (
    <span
      className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${spec.cls}`}
    >
      {spec.label}
    </span>
  );
}

function ConfirmDialog({
  title,
  children,
  onClose,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
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
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 text-sm text-foreground">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm font-medium text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-deficit px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Yes, delete
          </button>
        </div>
      </div>
    </div>
  );
}

function UndoToast({
  pending,
  onUndo,
}: {
  pending: PendingToast;
  onUndo: (p: PendingToast) => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, pending.scheduledAt - Date.now())
  );
  useEffect(() => {
    const t = setInterval(
      () => setRemaining(Math.max(0, pending.scheduledAt - Date.now())),
      200
    );
    return () => clearInterval(t);
  }, [pending.scheduledAt]);
  const seconds = Math.ceil(remaining / 1000);
  const pct = (remaining / 30_000) * 100;
  return (
    <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      <div className="flex items-center gap-3 p-3">
        <Trash2 className="h-4 w-4 text-deficit" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-medium">
            {pending.kind === "bank"
              ? `Disconnecting ${pending.label}`
              : `Removed ${pending.label}`}
          </p>
          <p className="truncate text-xs text-muted">{pending.countsLine}</p>
        </div>
        <span className="num text-xs text-muted">{seconds}s</span>
        <button
          onClick={() => onUndo(pending)}
          className="inline-flex items-center gap-1 rounded-lg border border-terracotta/40 bg-terracotta/10 px-2.5 py-1 text-xs font-medium text-terracotta hover:bg-terracotta/20"
        >
          <RotateCcw className="h-3 w-3" />
          Undo
        </button>
      </div>
      <div className="h-[3px] bg-border-subtle">
        <div
          className="h-full bg-deficit transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ReconnectLinkLauncher({
  itemId,
  token,
  onDone,
  onExit,
}: {
  itemId: string;
  token: string;
  onDone: () => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async () => {
      await fetch(`/api/plaid/items/${itemId}/complete-update`, {
        method: "POST",
      });
      onDone();
    },
    onExit: () => onExit(),
  });
  const fired = useRef(false);
  useEffect(() => {
    if (ready && !fired.current) {
      fired.current = true;
      open();
    }
  }, [ready, open]);
  return null;
}

// -----------------------------------------------------------------------------

function subtypeLabel(a: AccountRow): string {
  if (a.subtype) {
    return `${titleCase(a.subtype)} ${titleCase(a.type)}`.trim();
  }
  return titleCase(a.type);
}

function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .split(/[\s_-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Unused import suppressors — kept for future expansion.
void Plus;
