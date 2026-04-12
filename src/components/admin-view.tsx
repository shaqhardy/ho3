"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ElevatedCard } from "@/components/ui/card";
import { Shield, ShieldOff, Check, X, History } from "lucide-react";

interface UserEntry {
  profile: {
    id: string;
    email: string;
    full_name: string;
    role: string;
    allowed_books: string[];
  };
  mfa_enabled: boolean;
  mfa_factor_count: number;
  backup_codes_remaining: number;
  backup_codes_total: number;
  is_self: boolean;
}

interface AuditEntry {
  id: string;
  admin_user_id: string;
  target_user_id: string;
  action: string;
  reason: string | null;
  created_at: string;
  admin_name: string;
  target_name: string;
}

export function AdminView({
  users,
  recentActions,
}: {
  users: UserEntry[];
  recentActions: AuditEntry[];
}) {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<UserEntry | null>(null);
  const [reason, setReason] = useState("");

  async function unenrollMfa(targetUserId: string, reasonText: string) {
    setWorking(targetUserId);
    const res = await fetch("/api/admin/mfa-unenroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, reason: reasonText }),
    });
    setWorking(null);
    if (!res.ok) {
      const data = await res.json();
      alert(`Failed: ${data.error}`);
      return;
    }
    setConfirming(null);
    setReason("");
    router.refresh();
  }

  return (
    <div className="has-bottom-nav space-y-8">
      <header>
        <p className="label-sm">Admin</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          User &amp; MFA Management
        </h1>
      </header>

      <section>
        <div className="mb-3">
          <h2 className="label-sm">Users</h2>
        </div>
        <div className="space-y-3">
          {users.map((u) => (
            <Card key={u.profile.id} accent={u.mfa_enabled ? "surplus" : "deficit"}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {u.profile.full_name}
                    {u.is_self && (
                      <span className="ml-2 text-[10px] uppercase tracking-widest text-muted">
                        (you)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted">{u.profile.email}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-terracotta/10 px-2 py-0.5 text-terracotta font-medium">
                      {u.profile.role}
                    </span>
                    <span className="text-muted">
                      Books: {u.profile.allowed_books.join(", ")}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      {u.mfa_enabled ? (
                        <>
                          <Shield className="h-3.5 w-3.5 text-surplus" />
                          <span className="text-surplus font-medium">
                            MFA enabled ({u.mfa_factor_count})
                          </span>
                        </>
                      ) : (
                        <>
                          <ShieldOff className="h-3.5 w-3.5 text-deficit" />
                          <span className="text-deficit font-medium">
                            MFA disabled
                          </span>
                        </>
                      )}
                    </div>
                    {u.mfa_enabled && (
                      <div className="text-muted">
                        {u.backup_codes_remaining}/{u.backup_codes_total}{" "}
                        recovery codes
                        {u.backup_codes_total === 0 && (
                          <span className="ml-1 text-warning">(none set)</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {u.mfa_enabled && !u.is_self && (
                  <button
                    onClick={() => setConfirming(u)}
                    disabled={working === u.profile.id}
                    className="shrink-0 rounded-lg border border-deficit/30 bg-deficit/5 px-3 py-1.5 text-xs font-medium text-deficit hover:bg-deficit/10 disabled:opacity-50"
                  >
                    Unenroll MFA
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Confirmation modal */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setConfirming(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-foreground">
              Unenroll MFA for {confirming.profile.full_name}?
            </h3>
            <p className="mt-2 text-sm text-muted">
              This removes all their authenticator factors and wipes their
              recovery codes. They&apos;ll be prompted to set up a fresh
              authenticator on their next login.
            </p>

            <div className="mt-4">
              <label className="label-sm">Reason (for audit log)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Lost phone"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
            </div>

            <div className="mt-6 flex gap-2">
              <button
                onClick={() => {
                  setConfirming(null);
                  setReason("");
                }}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
              >
                <X className="inline h-4 w-4 mr-1" />
                Cancel
              </button>
              <button
                onClick={() => unenrollMfa(confirming.profile.id, reason)}
                disabled={working === confirming.profile.id}
                className="flex-1 rounded-lg bg-deficit px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Check className="inline h-4 w-4 mr-1" />
                {working === confirming.profile.id
                  ? "Unenrolling..."
                  : "Confirm unenroll"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit log */}
      {recentActions.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-muted" />
            <h2 className="label-sm">Recent admin actions</h2>
          </div>
          <ElevatedCard accent="none">
            <ul className="divide-y divide-border-subtle">
              {recentActions.map((a) => (
                <li key={a.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{a.admin_name}</span>{" "}
                    {a.action === "unenroll_totp" ? "unenrolled MFA for" : a.action}{" "}
                    <span className="font-medium">{a.target_name}</span>
                  </p>
                  {a.reason && (
                    <p className="text-xs text-muted mt-0.5">
                      &ldquo;{a.reason}&rdquo;
                    </p>
                  )}
                  <p className="text-[10px] text-muted mt-1">
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </ElevatedCard>
        </section>
      )}
    </div>
  );
}
