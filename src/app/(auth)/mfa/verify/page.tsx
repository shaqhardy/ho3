"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function MFAVerifyPage() {
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function checkFactors() {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: aal } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        router.replace("/overview");
        return;
      }

      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.find((f) => f.status === "verified");

      if (!totp) {
        router.replace("/mfa/enroll");
        return;
      }

      setFactorId(totp.id);
    }

    checkFactors();
  }, [router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;

    setLoading(true);
    setError(null);

    // Step 1: Server-side MFA verification (sets Set-Cookie headers AND returns tokens)
    const res = await fetch("/api/auth/mfa-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factorId, code }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Verification failed. Try again.");
      setCode("");
      setLoading(false);
      return;
    }

    // Step 2: Also set the session on the browser client directly
    // This writes AAL2 cookies via @supabase/ssr's built-in cookie handler
    // Belt-and-suspenders: even if Set-Cookie headers from step 1 work,
    // this ensures the browser client's internal state is also AAL2
    if (data.access_token && data.refresh_token) {
      const supabase = createClient();
      await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
    }

    // Step 3: Hard redirect — browser should have AAL2 cookies from
    // either the Set-Cookie headers or setSession() or both
    window.location.href = "/overview";
  }

  if (!factorId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Two-Factor Verification
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter the code from your authenticator app
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            required
            autoFocus
            autoComplete="one-time-code"
            className="w-full rounded-lg border border-border bg-card px-3 py-3 text-center text-2xl font-mono tracking-[0.5em] text-foreground placeholder-muted focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
            placeholder="000000"
          />

          {error && <p className="text-sm text-deficit text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>

        <button
          onClick={async () => {
            const supabase = createClient();
            await supabase.auth.signOut();
            window.location.href = "/login";
          }}
          className="mt-6 w-full text-center text-xs text-muted hover:text-foreground transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
