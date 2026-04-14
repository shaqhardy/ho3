"use client";

import { useState, useEffect } from "react";
import { Card, ElevatedCard } from "@/components/ui/card";
import {
  Bell,
  BellOff,
  Smartphone,
  Trash2,
  Check,
  Shield,
  ArrowRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { BOOK_LABELS } from "@/lib/books";

type Book = "personal" | "business" | "nonprofit";

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "user";
  allowed_books: Book[];
}

interface Preferences {
  bills_due: boolean;
  shortfall_warning: boolean;
  plaid_sync_errors: boolean;
  daily_summary: boolean;
  large_transactions: boolean;
  large_txn_threshold_personal: number;
  large_txn_threshold_business: number;
  large_txn_threshold_nonprofit: number;
  income_alerts: boolean;
  low_balance_warning: boolean;
  bill_paid_confirmation: boolean;
  bill_not_paid_alert: boolean;
  subscription_renewal_warning: boolean;
  debt_milestone_paid_off: boolean;
  debt_milestone_halfway: boolean;
  debt_milestone_custom: boolean;
  plaid_reconnect_needed: boolean;
  category_overspend: boolean;
  goal_hit: boolean;
}

interface Subscription {
  id: string;
  endpoint: string;
  user_agent: string | null;
  enabled: boolean;
  created_at: string;
  last_used_at: string;
}

interface AccountRow {
  id: string;
  name: string;
  book: Book;
  current_balance: number | string;
  low_balance_threshold: number | string | null;
}

interface DebtRow {
  id: string;
  creditor: string;
  nickname: string | null;
  current_balance: number | string;
  original_balance: number | string | null;
  custom_milestone_threshold: number | string | null;
  book: Book;
}

const DEFAULT_PREFS: Preferences = {
  bills_due: true,
  shortfall_warning: true,
  plaid_sync_errors: true,
  daily_summary: true,
  large_transactions: false,
  large_txn_threshold_personal: 100,
  large_txn_threshold_business: 250,
  large_txn_threshold_nonprofit: 250,
  income_alerts: true,
  low_balance_warning: true,
  bill_paid_confirmation: true,
  bill_not_paid_alert: true,
  subscription_renewal_warning: true,
  debt_milestone_paid_off: true,
  debt_milestone_halfway: true,
  debt_milestone_custom: true,
  plaid_reconnect_needed: true,
  category_overspend: false,
  goal_hit: false,
};

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return buffer;
}

function normalizePrefs(p: Partial<Preferences> | null | undefined): Preferences {
  const out = { ...DEFAULT_PREFS } as Preferences;
  if (!p) return out;
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Preferences)[]) {
    const v = p[k];
    if (v !== undefined && v !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[k] = v;
    }
  }
  return out;
}

export function SettingsView({
  profile,
  preferences: initialPreferences,
  subscriptions: initialSubscriptions,
  accounts: initialAccounts,
  debts: initialDebts,
  hasBudgets,
  hasGoals,
}: {
  profile: Profile | null;
  preferences: Partial<Preferences> | null;
  subscriptions: Subscription[];
  accounts: AccountRow[];
  debts: DebtRow[];
  hasBudgets: boolean;
  hasGoals: boolean;
}) {
  const [prefs, setPrefs] = useState<Preferences>(
    normalizePrefs(initialPreferences)
  );
  const [subscriptions, setSubscriptions] =
    useState<Subscription[]>(initialSubscriptions);
  const [accounts, setAccounts] = useState<AccountRow[]>(initialAccounts);
  const [debts, setDebts] = useState<DebtRow[]>(initialDebts);
  const [pushSupported, setPushSupported] = useState(false);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number | null>(
    null
  );
  const [regenerating, setRegenerating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [permissionState, setPermissionState] =
    useState<NotificationPermission>("default");
  const [isSubscribedHere, setIsSubscribedHere] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setPushSupported(supported);

    if (supported) {
      setPermissionState(Notification.permission);

      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribedHere(!!sub);
      });
    }

    // Fetch backup codes status
    fetch("/api/auth/mfa-backup-codes/status")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.remaining === "number") setBackupCodesRemaining(d.remaining);
      })
      .catch(() => {});
  }, []);

  async function regenerateBackupCodes() {
    if (
      !confirm(
        "Generate new recovery codes? Your existing codes will be invalidated."
      )
    )
      return;
    setRegenerating(true);
    const res = await fetch("/api/auth/mfa-backup-codes/generate", {
      method: "POST",
    });
    const data = await res.json();
    if (res.ok && data.codes) {
      setNewCodes(data.codes);
      setBackupCodesRemaining(data.codes.length);
    } else {
      alert(`Failed: ${data.error || "Unknown error"}`);
    }
    setRegenerating(false);
  }

  async function enableNotifications() {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      if (permission !== "granted") {
        setLoading(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      });

      const subJson = sub.toJSON();

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: {
            endpoint: subJson.endpoint,
            keys: subJson.keys,
          },
          userAgent: navigator.userAgent,
        }),
      });

      if (res.ok) {
        setIsSubscribedHere(true);
        window.location.reload();
      }
    } catch (err) {
      console.error("Enable notifications failed:", err);
      alert("Failed to enable notifications. Check console.");
    }
    setLoading(false);
  }

  async function disableOnThisDevice() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setIsSubscribedHere(false);
      window.location.reload();
    } catch (err) {
      console.error("Disable failed:", err);
    }
    setLoading(false);
  }

  async function updatePref<K extends keyof Preferences>(
    key: K,
    value: Preferences[K]
  ) {
    setPrefs((p) => ({ ...p, [key]: value }));
    await fetch("/api/push/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
  }

  async function updateAccountThreshold(id: string, value: number | null) {
    setAccounts((rows) =>
      rows.map((r) =>
        r.id === id ? { ...r, low_balance_threshold: value } : r
      )
    );
    await fetch(`/api/accounts/${id}/threshold`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ low_balance_threshold: value }),
    });
  }

  async function updateDebtMilestone(id: string, value: number | null) {
    setDebts((rows) =>
      rows.map((r) =>
        r.id === id ? { ...r, custom_milestone_threshold: value } : r
      )
    );
    await fetch(`/api/debts/${id}/milestones`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_milestone_threshold: value }),
    });
  }

  async function sendTest() {
    setTestResult(null);
    setLoading(true);
    const res = await fetch("/api/push/test", { method: "POST" });
    const data = await res.json();
    if (data.sent > 0) {
      setTestResult(`Sent to ${data.sent} device${data.sent > 1 ? "s" : ""}.`);
    } else {
      setTestResult(
        data.failed > 0
          ? `Failed to send (${data.failed} errors).`
          : "No devices subscribed."
      );
    }
    setLoading(false);
  }

  async function removeSubscription(id: string, endpoint: string) {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    setSubscriptions(subscriptions.filter((s) => s.id !== id));
  }

  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error - iOS Safari legacy property
      window.navigator.standalone === true);

  return (
    <div className="has-bottom-nav space-y-8">
      <header>
        <p className="label-sm">Account</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Settings
        </h1>
      </header>

      {/* Profile */}
      {profile && (
        <section>
          <div className="mb-3">
            <h2 className="label-sm">Profile</h2>
          </div>
          <Card>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Name</span>
                <span className="font-medium text-foreground">
                  {profile.full_name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Email</span>
                <span className="font-medium text-foreground">
                  {profile.email}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Role</span>
                <span className="font-medium text-foreground capitalize">
                  {profile.role}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Books</span>
                <span className="font-medium text-foreground capitalize">
                  {profile.allowed_books.join(", ")}
                </span>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* Security */}
      <section>
        <div className="mb-3">
          <h2 className="label-sm">Security</h2>
        </div>
        <ElevatedCard accent="terracotta">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-terracotta/15">
              <Shield className="h-5 w-5 text-terracotta" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground">
                Recovery Codes
              </h3>
              {backupCodesRemaining !== null && (
                <p className="mt-1 text-sm text-muted">
                  {backupCodesRemaining > 0 ? (
                    <>
                      You have{" "}
                      <span
                        className={`font-semibold ${
                          backupCodesRemaining <= 3
                            ? "text-warning"
                            : "text-foreground"
                        }`}
                      >
                        {backupCodesRemaining} recovery code
                        {backupCodesRemaining === 1 ? "" : "s"}
                      </span>{" "}
                      available.
                    </>
                  ) : (
                    <span className="text-warning">
                      No recovery codes on file. Generate a set so you can
                      regain access if you lose your authenticator.
                    </span>
                  )}
                </p>
              )}
              <button
                onClick={regenerateBackupCodes}
                disabled={regenerating}
                className="mt-3 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
              >
                {regenerating
                  ? "Generating..."
                  : backupCodesRemaining && backupCodesRemaining > 0
                    ? "Regenerate codes"
                    : "Generate codes"}
              </button>
            </div>
          </div>

          {newCodes && (
            <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-4">
              <p className="mb-2 text-xs font-semibold text-warning">
                Save these codes now — they won&apos;t be shown again.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-foreground">
                {newCodes.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-muted w-4">{i + 1}.</span>
                    <span className="tracking-wider">{c}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newCodes.join("\n"));
                }}
                className="mt-3 text-xs text-terracotta hover:underline"
              >
                Copy all
              </button>
              <button
                onClick={() => setNewCodes(null)}
                className="ml-3 mt-3 text-xs text-muted hover:text-foreground"
              >
                Hide
              </button>
            </div>
          )}
        </ElevatedCard>

        {profile?.role === "admin" && (
          <Link
            href="/settings/admin"
            className="mt-3 flex items-center justify-between rounded-xl border border-border bg-card p-4 hover:bg-card-hover transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terracotta/10">
                <Shield className="h-4 w-4 text-terracotta" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  User &amp; MFA Management
                </p>
                <p className="text-xs text-muted">
                  Unenroll MFA for other users · View audit log
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted" />
          </Link>
        )}
        {profile?.role === "admin" && (
          <Link
            href="/accounts"
            className="mt-3 flex items-center justify-between rounded-xl border border-border bg-card p-4 hover:bg-card-hover transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terracotta/10">
                <Shield className="h-4 w-4 text-terracotta" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Bank &amp; Account Management
                </p>
                <p className="text-xs text-muted">
                  Connect, disconnect, rename, reassign between books
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted" />
          </Link>
        )}
      </section>

      {/* Notifications */}
      <section>
        <div className="mb-3">
          <h2 className="label-sm">Notifications</h2>
        </div>

        <ElevatedCard accent="terracotta">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-terracotta/15">
              <Bell className="h-5 w-5 text-terracotta" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground">
                Push Notifications
              </h3>
              {!pushSupported && (
                <p className="mt-1 text-sm text-muted">
                  Your browser doesn&apos;t support push notifications.
                </p>
              )}

              {pushSupported && isIOS && !isStandalone && (
                <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                  <strong>iOS setup required:</strong> Add HO3 to your home
                  screen first (Share icon → Add to Home Screen), then open the
                  installed app and return to this page.
                </div>
              )}

              {pushSupported && permissionState === "denied" && (
                <p className="mt-2 text-sm text-deficit">
                  Notifications are blocked. Enable them in your browser
                  settings to continue.
                </p>
              )}

              {pushSupported &&
                permissionState !== "denied" &&
                !isSubscribedHere && (
                  <div className="mt-3">
                    <p className="text-sm text-muted">
                      Get alerts for bills, shortfalls, and daily summaries.
                    </p>
                    <button
                      onClick={enableNotifications}
                      disabled={loading || (isIOS && !isStandalone)}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
                    >
                      <Bell className="h-4 w-4" />
                      {loading ? "Enabling..." : "Enable notifications"}
                    </button>
                  </div>
                )}

              {pushSupported && isSubscribedHere && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surplus/10 px-2.5 py-1 text-xs font-medium text-surplus">
                    <Check className="h-3 w-3" />
                    Enabled on this device
                  </span>
                  <button
                    onClick={sendTest}
                    disabled={loading}
                    className="text-xs font-medium text-terracotta hover:underline disabled:opacity-50"
                  >
                    Send test
                  </button>
                  <button
                    onClick={disableOnThisDevice}
                    disabled={loading}
                    className="text-xs font-medium text-muted hover:text-deficit disabled:opacity-50"
                  >
                    Disable on this device
                  </button>
                  {testResult && (
                    <p className="w-full mt-2 text-xs text-muted">{testResult}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </ElevatedCard>

        {/* Alert type toggles */}
        {isSubscribedHere && (
          <>
            {/* Original set */}
            <div className="mt-4">
              <div className="mb-3">
                <h3 className="label-sm">Scheduled alerts</h3>
              </div>
              <Card>
                <div className="divide-y divide-border-subtle">
                  <ToggleRow
                    label="Bills due tomorrow"
                    description="One alert per bill at 7am Pacific"
                    checked={prefs.bills_due}
                    onChange={(v) => updatePref("bills_due", v)}
                  />
                  <ToggleRow
                    label="Shortfall warnings"
                    description="When your 14-day projection shows a gap"
                    checked={prefs.shortfall_warning}
                    onChange={(v) => updatePref("shortfall_warning", v)}
                  />
                  <ToggleRow
                    label="Plaid sync errors"
                    description="When a bank connection fails to sync"
                    checked={prefs.plaid_sync_errors}
                    onChange={(v) => updatePref("plaid_sync_errors", v)}
                  />
                  <ToggleRow
                    label="Daily summary"
                    description="Morning recap at 7am Pacific"
                    checked={prefs.daily_summary}
                    onChange={(v) => updatePref("daily_summary", v)}
                  />
                </div>
              </Card>
            </div>

            {/* Transactions & Balances */}
            <div className="mt-4">
              <div className="mb-3">
                <h3 className="label-sm">Transactions &amp; balances</h3>
              </div>
              <Card>
                <div className="divide-y divide-border-subtle">
                  <ToggleRow
                    label="Large transactions"
                    description="Alert when a charge crosses your threshold per book"
                    checked={prefs.large_transactions}
                    onChange={(v) => updatePref("large_transactions", v)}
                  />
                  <ToggleRow
                    label="Income alerts"
                    description="Celebrate when income hits your account"
                    checked={prefs.income_alerts}
                    onChange={(v) => updatePref("income_alerts", v)}
                  />
                  <ToggleRow
                    label="Low balance warning"
                    description="Alert when an account drops below its threshold"
                    checked={prefs.low_balance_warning}
                    onChange={(v) => updatePref("low_balance_warning", v)}
                  />
                </div>
              </Card>
            </div>

            {/* Bills & Subscriptions */}
            <div className="mt-4">
              <div className="mb-3">
                <h3 className="label-sm">Bills &amp; subscriptions</h3>
              </div>
              <Card>
                <div className="divide-y divide-border-subtle">
                  <ToggleRow
                    label="Bill paid confirmation"
                    description="Confirm when a matched transaction pays a bill"
                    checked={prefs.bill_paid_confirmation}
                    onChange={(v) => updatePref("bill_paid_confirmation", v)}
                  />
                  <ToggleRow
                    label="BILL NOT PAID alert"
                    description="Warn if a bill passes its due date without a match"
                    checked={prefs.bill_not_paid_alert}
                    onChange={(v) => updatePref("bill_not_paid_alert", v)}
                  />
                  <ToggleRow
                    label="Subscription renewal warning"
                    description="3-day heads-up before a subscription renews"
                    checked={prefs.subscription_renewal_warning}
                    onChange={(v) =>
                      updatePref("subscription_renewal_warning", v)
                    }
                  />
                </div>
              </Card>
            </div>

            {/* Debt Milestones */}
            <div className="mt-4">
              <div className="mb-3">
                <h3 className="label-sm">Debt milestones</h3>
              </div>
              <Card>
                <div className="divide-y divide-border-subtle">
                  <ToggleRow
                    label="Paid off"
                    description="When a debt hits $0"
                    checked={prefs.debt_milestone_paid_off}
                    onChange={(v) => updatePref("debt_milestone_paid_off", v)}
                  />
                  <ToggleRow
                    label="Halfway"
                    description="Half the original balance paid down"
                    checked={prefs.debt_milestone_halfway}
                    onChange={(v) => updatePref("debt_milestone_halfway", v)}
                  />
                  <ToggleRow
                    label="Custom milestone"
                    description="Per-debt threshold (set below in Advanced)"
                    checked={prefs.debt_milestone_custom}
                    onChange={(v) => updatePref("debt_milestone_custom", v)}
                  />
                </div>
              </Card>
            </div>

            {/* Plaid */}
            <div className="mt-4">
              <div className="mb-3">
                <h3 className="label-sm">Plaid</h3>
              </div>
              <Card>
                <div className="divide-y divide-border-subtle">
                  <ToggleRow
                    label="Reconnect needed"
                    description="When a bank asks you to sign back in"
                    checked={prefs.plaid_reconnect_needed}
                    onChange={(v) => updatePref("plaid_reconnect_needed", v)}
                  />
                </div>
              </Card>
            </div>

            {/* Budgets */}
            <div className="mt-4">
              <div className="mb-3">
                <h3 className="label-sm">Budgets</h3>
              </div>
              <Card>
                <div className="divide-y divide-border-subtle">
                  <ToggleRow
                    label="Category overspend"
                    description={
                      hasBudgets
                        ? "When spending exceeds a budget category"
                        : "Create a budget first"
                    }
                    checked={prefs.category_overspend && hasBudgets}
                    disabled={!hasBudgets}
                    onChange={(v) => updatePref("category_overspend", v)}
                  />
                </div>
              </Card>
            </div>

            {/* Goals */}
            <div className="mt-4">
              <div className="mb-3">
                <h3 className="label-sm">Goals</h3>
              </div>
              <Card>
                <div className="divide-y divide-border-subtle">
                  <ToggleRow
                    label="Goal hit"
                    description={
                      hasGoals
                        ? "When you reach a savings or payoff goal"
                        : "Create a goal first"
                    }
                    checked={prefs.goal_hit && hasGoals}
                    disabled={!hasGoals}
                    onChange={(v) => updatePref("goal_hit", v)}
                  />
                </div>
              </Card>
            </div>

            {/* Advanced thresholds */}
            <div className="mt-4">
              <button
                onClick={() => setAdvancedOpen((x) => !x)}
                className="mb-3 flex w-full items-center gap-2 text-left"
                aria-expanded={advancedOpen}
              >
                {advancedOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted" />
                )}
                <span className="label-sm">Advanced thresholds</span>
              </button>

              {advancedOpen && (
                <div className="space-y-4">
                  {/* Per-book large transaction thresholds */}
                  <Card>
                    <p className="mb-3 text-sm font-medium text-foreground">
                      Large transaction threshold
                    </p>
                    <p className="mb-3 text-xs text-muted">
                      Alert when a charge in that book is at or above this
                      amount.
                    </p>
                    <div className="space-y-3">
                      <ThresholdField
                        label={BOOK_LABELS.personal}
                        value={prefs.large_txn_threshold_personal}
                        onCommit={(n) =>
                          updatePref("large_txn_threshold_personal", n)
                        }
                      />
                      <ThresholdField
                        label={BOOK_LABELS.business}
                        value={prefs.large_txn_threshold_business}
                        onCommit={(n) =>
                          updatePref("large_txn_threshold_business", n)
                        }
                      />
                      <ThresholdField
                        label={BOOK_LABELS.nonprofit}
                        value={prefs.large_txn_threshold_nonprofit}
                        onCommit={(n) =>
                          updatePref("large_txn_threshold_nonprofit", n)
                        }
                      />
                    </div>
                  </Card>

                  {/* Per-account low balance thresholds */}
                  {accounts.length > 0 && (
                    <Card>
                      <p className="mb-3 text-sm font-medium text-foreground">
                        Low balance thresholds
                      </p>
                      <p className="mb-3 text-xs text-muted">
                        Default is $200. Adjust per account.
                      </p>
                      <div className="divide-y divide-border-subtle">
                        {accounts.map((acc) => (
                          <AccountThresholdRow
                            key={acc.id}
                            account={acc}
                            onCommit={(n) =>
                              updateAccountThreshold(acc.id, n)
                            }
                          />
                        ))}
                      </div>
                    </Card>
                  )}

                  {/* Per-debt custom milestone thresholds */}
                  {debts.length > 0 && (
                    <Card>
                      <p className="mb-3 text-sm font-medium text-foreground">
                        Debt custom milestones
                      </p>
                      <p className="mb-3 text-xs text-muted">
                        Fire once when a debt&apos;s balance drops to or below
                        this amount.
                      </p>
                      <div className="divide-y divide-border-subtle">
                        {debts.map((d) => (
                          <DebtMilestoneRow
                            key={d.id}
                            debt={d}
                            onCommit={(n) => updateDebtMilestone(d.id, n)}
                          />
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Device list */}
        {subscriptions.length > 0 && (
          <div className="mt-4">
            <div className="mb-3">
              <h3 className="label-sm">Devices</h3>
            </div>
            <Card>
              <ul className="divide-y divide-border-subtle">
                {subscriptions.map((sub) => (
                  <li
                    key={sub.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Smartphone className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">
                          {shortDevice(sub.user_agent)}
                        </p>
                        <p className="text-xs text-muted">
                          Added {new Date(sub.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeSubscription(sub.id, sub.endpoint)}
                      className="text-muted hover:text-deficit"
                      aria-label="Remove device"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium ${
            disabled ? "text-muted" : "text-foreground"
          }`}
        >
          {label}
        </p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-terracotta" : "bg-border"
        } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function ThresholdField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted">$</span>
        <input
          type="number"
          min={0}
          step={5}
          inputMode="decimal"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => {
            const n = Number(local);
            if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
            else setLocal(String(value));
          }}
          className="w-24 rounded-lg border border-border bg-background px-3 py-1.5 text-right text-sm text-foreground focus:border-terracotta focus:outline-none"
        />
      </div>
    </label>
  );
}

function AccountThresholdRow({
  account,
  onCommit,
}: {
  account: AccountRow;
  onCommit: (n: number | null) => void;
}) {
  const initial =
    account.low_balance_threshold === null
      ? ""
      : String(Number(account.low_balance_threshold));
  const [local, setLocal] = useState(initial);

  useEffect(() => {
    setLocal(
      account.low_balance_threshold === null
        ? ""
        : String(Number(account.low_balance_threshold))
    );
  }, [account.low_balance_threshold]);

  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{account.name}</p>
        <p className="text-xs text-muted capitalize">
          {account.book} · Balance{" "}
          {Number(account.current_balance).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          })}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted">$</span>
        <input
          type="number"
          min={0}
          step={10}
          inputMode="decimal"
          placeholder="200"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => {
            if (local.trim() === "") {
              if (account.low_balance_threshold !== null) onCommit(null);
              return;
            }
            const n = Number(local);
            if (
              Number.isFinite(n) &&
              n >= 0 &&
              n !== Number(account.low_balance_threshold)
            ) {
              onCommit(n);
            } else {
              setLocal(
                account.low_balance_threshold === null
                  ? ""
                  : String(Number(account.low_balance_threshold))
              );
            }
          }}
          className="w-24 rounded-lg border border-border bg-background px-3 py-1.5 text-right text-sm text-foreground focus:border-terracotta focus:outline-none"
        />
      </div>
    </div>
  );
}

function DebtMilestoneRow({
  debt,
  onCommit,
}: {
  debt: DebtRow;
  onCommit: (n: number | null) => void;
}) {
  const initial =
    debt.custom_milestone_threshold === null
      ? ""
      : String(Number(debt.custom_milestone_threshold));
  const [local, setLocal] = useState(initial);

  useEffect(() => {
    setLocal(
      debt.custom_milestone_threshold === null
        ? ""
        : String(Number(debt.custom_milestone_threshold))
    );
  }, [debt.custom_milestone_threshold]);

  const name = debt.nickname || debt.creditor;

  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{name}</p>
        <p className="text-xs text-muted">
          Current{" "}
          {Number(debt.current_balance).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          })}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted">$</span>
        <input
          type="number"
          min={0}
          step={50}
          inputMode="decimal"
          placeholder="—"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => {
            if (local.trim() === "") {
              if (debt.custom_milestone_threshold !== null) onCommit(null);
              return;
            }
            const n = Number(local);
            if (
              Number.isFinite(n) &&
              n >= 0 &&
              n !== Number(debt.custom_milestone_threshold)
            ) {
              onCommit(n);
            } else {
              setLocal(
                debt.custom_milestone_threshold === null
                  ? ""
                  : String(Number(debt.custom_milestone_threshold))
              );
            }
          }}
          className="w-28 rounded-lg border border-border bg-background px-3 py-1.5 text-right text-sm text-foreground focus:border-terracotta focus:outline-none"
        />
      </div>
    </div>
  );
}

function shortDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return ua.slice(0, 40) + (ua.length > 40 ? "…" : "");
}

// Prevent tree-shake pressure on import.
void BellOff;
