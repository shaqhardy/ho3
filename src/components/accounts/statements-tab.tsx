"use client";

import { useMemo, useState } from "react";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { AccountStatement } from "@/lib/types";

interface Props {
  accountId: string;
  statements: AccountStatement[];
}

export default function StatementsTab({ accountId, statements }: Props) {
  const sorted = useMemo(() => {
    return [...statements].sort((a, b) => {
      const ae = a.period_end ?? "";
      const be = b.period_end ?? "";
      return be.localeCompare(ae);
    });
  }, [statements]);

  const [selectedId, setSelectedId] = useState<string | null>(
    sorted[0]?.id ?? null
  );
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const selected = sorted.find((s) => s.id === selectedId) ?? null;

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/plaid/sync-statements", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || `Sync failed (${res.status})`);
      }
      // Refresh the page to pull in any new statements via server props.
      if (typeof window !== "undefined") window.location.reload();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (sorted.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-10 text-center">
        <FileText className="h-8 w-8 text-muted" aria-hidden />
        <p className="text-sm text-muted">No statements available yet</p>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-card-hover px-3 py-1.5 text-sm hover:bg-card disabled:opacity-60"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          {syncing ? "Syncing…" : "Sync statements"}
        </button>
        {syncError && (
          <p className="text-xs text-deficit" role="alert">
            {syncError}
          </p>
        )}
      </Card>
    );
  }

  const viewerUrl = selected
    ? `/api/accounts/${accountId}/statements/${selected.id}/download`
    : null;
  const downloadUrl = selected ? `${viewerUrl}?download=1` : null;

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="label-sm">Statements</p>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground disabled:opacity-60"
            aria-label="Sync statements"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            {syncing ? "Syncing" : "Sync"}
          </button>
        </div>
        {syncError && (
          <p className="text-xs text-deficit" role="alert">
            {syncError}
          </p>
        )}
        <ul className="space-y-1.5">
          {sorted.map((s) => {
            const isActive = s.id === selectedId;
            const range =
              s.period_start && s.period_end
                ? `${formatShortDate(s.period_start)} – ${formatShortDate(
                    s.period_end
                  )}`
                : s.period_end
                ? formatShortDate(s.period_end)
                : "Statement";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? "border-terracotta bg-card-hover"
                      : "border-border-subtle bg-card hover:bg-card-hover"
                  }`}
                >
                  <p className="text-sm font-medium">{range}</p>
                  {s.closing_balance !== null && (
                    <p className="num mt-0.5 text-xs text-muted">
                      Close {formatCurrency(Number(s.closing_balance))}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-3">
        {selected && (
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="label-sm">Period</p>
                <p className="text-sm font-medium">
                  {selected.period_start && selected.period_end
                    ? `${formatShortDate(
                        selected.period_start
                      )} – ${formatShortDate(selected.period_end)}`
                    : selected.period_end
                    ? formatShortDate(selected.period_end)
                    : "—"}
                </p>
              </div>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-card-hover px-3 py-1.5 text-sm hover:bg-card"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Download
                </a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatLine
                label="Opening"
                value={selected.opening_balance}
              />
              <StatLine
                label="Closing"
                value={selected.closing_balance}
              />
              <StatLine
                label="Debits"
                value={selected.total_debits}
              />
              <StatLine
                label="Credits"
                value={selected.total_credits}
              />
            </div>
          </Card>
        )}

        {viewerUrl && (
          <Card className="overflow-hidden p-0">
            <iframe
              key={viewerUrl}
              src={viewerUrl}
              title="Statement PDF"
              className="h-[70vh] w-full bg-white"
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function StatLine({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div>
      <p className="label-sm">{label}</p>
      <p className="num mt-1 text-sm font-medium">
        {value === null || value === undefined
          ? "—"
          : formatCurrency(Number(value))}
      </p>
    </div>
  );
}
