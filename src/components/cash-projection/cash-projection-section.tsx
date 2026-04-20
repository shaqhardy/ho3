"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CashProjectionBoxes, CashProjectionSkeleton } from "./boxes";
import {
  CashProjectionHeader,
  loadCashProjectionPrefs,
  saveCashProjectionPrefs,
} from "./cash-projection-header";
import { DeficitBanner } from "./deficit-banner";
import { Panel } from "./panel";
import {
  BreakdownSkeleton,
  CashBreakdown,
  CombinedBreakdown,
  ExpensesBreakdown,
  IncomeBreakdown,
} from "./breakdowns";
import type {
  BookScope,
  CashMode,
  CashProjectionResponse,
  CashWindow,
} from "./types";
import type { CashProjectionDetail } from "@/lib/cash-projection/detail-types";

interface Props {
  book: BookScope;
  hasData: boolean;
}

type BreakdownTarget = "cash" | "income" | "combined" | "expenses" | null;

export function CashProjectionSection({ book, hasData }: Props) {
  const [window, setWindow] = useState<CashWindow>("month");
  const [mode, setMode] = useState<CashMode>("projected");
  const [data, setData] = useState<CashProjectionResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hydrated = useRef(false);

  // Drill-down panel state.
  const [target, setTarget] = useState<BreakdownTarget>(null);
  const [detail, setDetail] = useState<CashProjectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  // Cache key: "window:mode" — invalidated on toggle change.
  const detailCacheKey = useRef<string | null>(null);

  useEffect(() => {
    const prefs = loadCashProjectionPrefs({
      window: "month",
      mode: "projected",
    });
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

  const fetchDetail = useCallback(
    async (w: CashWindow, m: CashMode) => {
      const key = `${book}:${w}:${m}`;
      if (detailCacheKey.current === key && detail) return;
      setDetailLoading(true);
      setDetailErr(null);
      try {
        const params = new URLSearchParams({
          book,
          window: w,
          mode: m,
          detail: "true",
        });
        const res = await fetch(`/api/cash-projection?${params.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || "Failed to load breakdown");
        }
        const json = (await res.json()) as CashProjectionResponse;
        setDetail(json.detail ?? null);
        detailCacheKey.current = key;
      } catch (e) {
        setDetailErr((e as Error).message);
      } finally {
        setDetailLoading(false);
      }
    },
    [book, detail]
  );

  useEffect(() => {
    if (!hydrated.current) return;
    fetchProjection(window, mode);
    saveCashProjectionPrefs(window, mode);
    // Invalidate detail cache when toggles change.
    detailCacheKey.current = null;
    setDetail(null);
  }, [fetchProjection, window, mode]);

  function openBreakdown(t: BreakdownTarget) {
    setTarget(t);
    if (t !== null && t !== "combined") {
      void fetchDetail(window, mode);
    }
  }

  function closeBreakdown() {
    setTarget(null);
  }

  const showDeficit =
    data &&
    data.combined.is_deficit &&
    hasData &&
    (data.cash.starting_balance !== 0 ||
      data.income.amount !== 0 ||
      data.expected_expenses.deduplicated_total !== 0);

  const panelTitle =
    target === "cash"
      ? "Cash breakdown"
      : target === "income"
        ? "Income breakdown"
        : target === "combined"
          ? "Combined breakdown"
          : target === "expenses"
            ? "Expenses breakdown"
            : "";
  const panelSubtitle = data
    ? `${data.window.label} · ${
        data.mode[0].toUpperCase() + data.mode.slice(1)
      }`
    : undefined;

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
          <CashProjectionBoxes
            data={data}
            onOpenCash={() => openBreakdown("cash")}
            onOpenIncome={() => openBreakdown("income")}
            onOpenCombined={() => openBreakdown("combined")}
          />
          {!hasData && (
            <p className="text-center text-xs text-muted">
              No data yet. Connect an account or set up your Plan to see
              projections.
            </p>
          )}
        </>
      )}

      <Panel
        open={target !== null}
        onClose={closeBreakdown}
        title={panelTitle}
        subtitle={panelSubtitle}
      >
        {data && target === "combined" && (
          <CombinedBreakdown
            summary={data}
            onOpenCash={() => openBreakdown("cash")}
            onOpenIncome={() => openBreakdown("income")}
            onOpenExpenses={() => openBreakdown("expenses")}
          />
        )}
        {data &&
          (target === "cash" || target === "income" || target === "expenses") &&
          (detailErr ? (
            <p className="rounded bg-deficit/10 px-3 py-2 text-sm text-deficit">
              {detailErr}
            </p>
          ) : detailLoading || !detail ? (
            <BreakdownSkeleton />
          ) : target === "cash" ? (
            <CashBreakdown summary={data} detail={detail} />
          ) : target === "income" ? (
            <IncomeBreakdown summary={data} detail={detail} />
          ) : (
            <ExpensesBreakdown summary={data} detail={detail} />
          ))}
      </Panel>
    </div>
  );
}
