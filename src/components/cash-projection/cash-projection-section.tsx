"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CashProjectionBoxes, CashProjectionSkeleton } from "./boxes";
import {
  CashProjectionHeader,
  loadCashProjectionPrefs,
  saveCashProjectionPrefs,
} from "./cash-projection-header";
import { DeficitBanner } from "./deficit-banner";
import type {
  BookScope,
  CashMode,
  CashProjectionResponse,
  CashWindow,
} from "./types";

interface Props {
  book: BookScope;
  hasData: boolean;
}

export function CashProjectionSection({ book, hasData }: Props) {
  const [window, setWindow] = useState<CashWindow>("month");
  const [mode, setMode] = useState<CashMode>("projected");
  const [data, setData] = useState<CashProjectionResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hydrated = useRef(false);

  useEffect(() => {
    const prefs = loadCashProjectionPrefs({ window: "month", mode: "projected" });
    setWindow(prefs.window);
    setMode(prefs.mode);
    hydrated.current = true;
  }, []);

  const fetchProjection = useCallback(
    async (w: CashWindow, m: CashMode) => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams({ book, window: w, mode: m });
        const res = await fetch(`/api/cash-projection?${params.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || "Failed to load projection");
        }
        const json = (await res.json()) as CashProjectionResponse;
        setData(json);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [book]
  );

  useEffect(() => {
    if (!hydrated.current) return;
    fetchProjection(window, mode);
    saveCashProjectionPrefs(window, mode);
  }, [fetchProjection, window, mode]);

  const showDeficit =
    data &&
    data.combined.is_deficit &&
    // Suppress deficit banner on pure-empty scope (0 across the board) so a
    // brand-new book doesn't look alarming.
    hasData &&
    (data.cash.starting_balance !== 0 ||
      data.income.amount !== 0 ||
      data.expected_expenses.deduplicated_total !== 0);

  return (
    <div className="space-y-4">
      <CashProjectionHeader
        window={window}
        mode={mode}
        onWindowChange={setWindow}
        onModeChange={setMode}
      />
      {showDeficit && data && (
        <DeficitBanner
          amount={data.combined.amount}
          windowLabel={data.window.label}
        />
      )}
      {err && (
        <p className="rounded bg-deficit/10 px-3 py-2 text-sm text-deficit">
          {err}
        </p>
      )}
      {loading || !data ? (
        <CashProjectionSkeleton />
      ) : (
        <>
          <CashProjectionBoxes data={data} />
          {!hasData && (
            <p className="text-center text-xs text-muted">
              No data yet. Connect an account or set up your Plan to see
              projections.
            </p>
          )}
        </>
      )}
    </div>
  );
}
