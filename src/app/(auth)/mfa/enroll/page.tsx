"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function MFAEnrollPage() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function startEnroll() {
      const supabase = createClient();

      // Check if already enrolled
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.find((f) => f.status === "verified");
      if (totp) {
        // Already enrolled, go to verify
        router.replace("/mfa/verify");
        return;
      }

      // Clean slate — unenroll any existing unverified factors
      // (listFactors only returns verified ones, so we proceed to enroll)

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "HO3 Authenticator",
      });

      if (error) {
        setError(error.message);
        setEnrolling(false);
        return;
      }

      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
      setEnrolling(false);
    }

    startEnroll();
  }, [router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();

    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });

    if (challengeError) {
      setError(challengeError.message);
      setLoading(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (verifyError) {
      setError(verifyError.message);
      setCode("");
      setLoading(false);
      return;
    }

    router.push("/overview");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Set Up Two-Factor Auth
          </h1>
          <p className="mt-2 text-sm text-muted">
            Scan this QR code with your authenticator app (Google Authenticator,
            Authy, 1Password, etc.)
          </p>
        </div>

        {enrolling && (
          <div className="text-center py-12">
            <p className="text-sm text-muted">Setting up MFA...</p>
          </div>
        )}

        {qrCode && (
          <div className="space-y-6">
            <div className="flex justify-center rounded-xl bg-white p-4">
              <Image
                src={qrCode}
                alt="QR Code for authenticator app"
                width={200}
                height={200}
                unoptimized
              />
            </div>

            {secret && (
              <div className="text-center">
                <p className="text-xs text-muted mb-1">
                  Or enter this code manually:
                </p>
                <code className="text-xs font-mono text-terracotta bg-card px-3 py-1.5 rounded-lg select-all break-all">
                  {secret}
                </code>
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label
                  htmlFor="code"
                  className="block text-sm font-medium text-muted mb-1"
                >
                  Enter the 6-digit code from your app
                </label>
                <input
                  id="code"
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
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-center text-2xl font-mono tracking-[0.5em] text-foreground placeholder-muted focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                  placeholder="000000"
                />
              </div>

              {error && <p className="text-sm text-deficit">{error}</p>}

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify & Enable MFA"}
              </button>
            </form>
          </div>
        )}

        {!enrolling && !qrCode && error && (
          <div className="text-center">
            <p className="text-sm text-deficit mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-terracotta hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
