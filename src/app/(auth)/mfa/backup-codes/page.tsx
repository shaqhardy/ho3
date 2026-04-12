"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Check, AlertTriangle } from "lucide-react";

export default function BackupCodesPage() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function generate() {
      setLoading(true);
      const res = await fetch("/api/auth/mfa-backup-codes/generate", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.codes) {
        setCodes(data.codes);
      } else {
        setError(data.error || "Failed to generate codes");
      }
      setLoading(false);
    }
    generate();
  }, []);

  function copyToClipboard() {
    if (!codes) return;
    navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    if (!codes) return;
    const content = [
      "HO3 Recovery Codes",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      "Each code works once. Store these somewhere safe (password manager,",
      "printed and kept with important documents). If you lose access to",
      "your authenticator app, use one of these codes to recover your account.",
      "",
      ...codes,
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `HO3-recovery-codes-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Save Your Recovery Codes
          </h1>
          <p className="mt-2 text-sm text-muted">
            These codes are the only way to recover your account if you lose
            your authenticator.
          </p>
        </div>

        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Save these now.</strong> You won&apos;t be able to see them
            again. Each code works once.
          </div>
        </div>

        {loading && (
          <div className="text-center py-8">
            <p className="text-sm text-muted">Generating codes...</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-deficit/30 bg-deficit/5 p-4 text-sm text-deficit">
            {error}
          </div>
        )}

        {codes && (
          <>
            <div className="rounded-xl border border-border bg-card p-5 mb-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm text-foreground">
                {codes.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted w-4">{i + 1}.</span>
                    <span className="tracking-wider">{c}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={copyToClipboard}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground hover:bg-card-hover"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-surplus" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={download}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground hover:bg-card-hover"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>

            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border bg-card text-terracotta focus:ring-terracotta"
              />
              <span className="text-sm text-muted">
                I&apos;ve saved these codes somewhere safe. I understand I
                won&apos;t be able to see them again.
              </span>
            </label>

            <button
              onClick={() => router.push("/overview")}
              disabled={!confirmed}
              className="w-full rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
            >
              Continue to HO3
            </button>
          </>
        )}
      </div>
    </div>
  );
}
