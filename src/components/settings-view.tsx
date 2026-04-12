"use client";

import { useState, useEffect } from "react";
import { Card, ElevatedCard } from "@/components/ui/card";
import { Bell, BellOff, Smartphone, Trash2, Check } from "lucide-react";

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "user";
  allowed_books: string[];
}

interface Preferences {
  bills_due: boolean;
  shortfall_warning: boolean;
  plaid_sync_errors: boolean;
  daily_summary: boolean;
}

interface Subscription {
  id: string;
  endpoint: string;
  user_agent: string | null;
  enabled: boolean;
  created_at: string;
  last_used_at: string;
}

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

export function SettingsView({
  profile,
  preferences: initialPreferences,
  subscriptions: initialSubscriptions,
}: {
  profile: Profile | null;
  preferences: Preferences | null;
  subscriptions: Subscription[];
}) {
  const [prefs, setPrefs] = useState<Preferences>(
    initialPreferences || {
      bills_due: true,
      shortfall_warning: true,
      plaid_sync_errors: true,
      daily_summary: true,
    }
  );
  const [subscriptions, setSubscriptions] =
    useState<Subscription[]>(initialSubscriptions);
  const [pushSupported, setPushSupported] = useState(false);
  const [permissionState, setPermissionState] =
    useState<NotificationPermission>("default");
  const [isSubscribedHere, setIsSubscribedHere] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

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
  }, []);

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
        // Refresh subscription list
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

  async function updatePref(key: keyof Preferences, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await fetch("/api/push/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
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

              {pushSupported &&
                permissionState === "denied" && (
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
          <div className="mt-4">
            <div className="mb-3">
              <h3 className="label-sm">Alert types</h3>
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
                  description="When a bank connection needs attention"
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
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-terracotta" : "bg-border"
        }`}
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

function shortDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return ua.slice(0, 40) + (ua.length > 40 ? "…" : "");
}

// BellOff for when we want to silence — not used currently but imported to avoid tree-shaking pressure.
void BellOff;
