"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function MFARecoverPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
      } else {
        setAuthed(true);
      }
    }
    check();
  }, [router]);

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/mfa-recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Recovery failed");
      setLoading(false);
      return;
    }

    // Sign out so the stale session is cleared, then send user to login
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login?recovered=1";
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Recover Account Access
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter one of your recovery codes. This will reset your two-factor
            authentication so you can set it up again with a new authenticator.
          </p>
        </div>

        <form onSubmit={handleRecover} className="space-y-4">
          <input
            type="text"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))
            }
            required
            autoFocus
            maxLength={16}
            placeholder="XXXX-XXXXXX"
            className="w-full rounded-lg border border-border bg-card px-3 py-3 text-center text-lg font-mono tracking-widest text-foreground placeholder-muted focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
          />

          {error && <p className="text-sm text-deficit text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading || code.length < 10}
            className="w-full rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Recover account"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <a
            href="/mfa/verify"
            className="text-xs text-muted hover:text-foreground"
          >
            ← Back to verification
          </a>
        </div>

        <div className="mt-8 rounded-lg border border-border/50 bg-card/50 p-3 text-xs text-muted">
          <strong className="text-foreground">Don&apos;t have your codes?</strong>{" "}
          Ask your account co-owner to unenroll your MFA from their Settings →
          Admin page. You&apos;ll then be prompted to set up a fresh
          authenticator on your next login.
        </div>
      </div>
    </div>
  );
}
