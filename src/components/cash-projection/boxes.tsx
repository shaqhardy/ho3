"use client";

import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { CashProjectionResponse } from "./types";

function modeLabel(mode: string): string {
  switch (mode) {
    case "live":
      return "Live";
    case "scheduled":
      return "Scheduled";
    case "projected":
      return "Projected";
    default:
      return mode;
  }
}

/**
 * Shared clickable wrapper. role=button + Enter/Space + hover lift + info
 * icon in the top-right to telegraph "click me".
 */
function ClickableCard({
  onClick,
  className = "",
  children,
  ariaLabel,
}: {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group relative cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card
        interactive
        className={`flex min-h-[200px] flex-col justify-between p-6 transition-transform group-hover:-translate-y-[1px] sm:min-h-[220px] ${className}`}
      >
        <span
          aria-hidden
          className="absolute right-4 top-4 text-muted opacity-50 transition-opacity group-hover:opacity-100"
        >
          <Info className="h-4 w-4" />
        </span>
        {children}
      </Card>
    </div>
  );
}

// Headline number sizing — bumped ~17% over display-value across the board,
// Combined goes another ~20% on top to anchor the page.
const headlineCls =
  "text-[2rem] leading-none font-bold tabular-nums tracking-tight sm:text-[2.375rem]";
const combinedHeadlineCls =
  "text-[2.5rem] leading-none font-bold tabular-nums tracking-tight sm:text-[3rem]";

function MetaLine({ mode, windowLabel }: { mode: string; windowLabel: string }) {
  return (
    <p className="text-xs text-muted">
      <span className="font-medium text-foreground/80">{modeLabel(mode)}</span>
      <span className="mx-1.5 text-muted">·</span>
      <span>{windowLabel}</span>
    </p>
  );
}

export function CashBox({
  amount,
  mode,
  windowLabel,
  subtext,
  onClick,
}: {
  amount: number;
  mode: string;
  windowLabel: string;
  subtext?: string | null;
  onClick: () => void;
}) {
  return (
    <ClickableCard
      onClick={onClick}
      ariaLabel={`Cash breakdown for ${modeLabel(mode)} over ${windowLabel}`}
    >
      <div>
        <p className="label-sm">Cash</p>
        <p className={`mt-3 text-foreground ${headlineCls}`}>
          {formatCurrency(amount)}
        </p>
      </div>
      <div className="mt-4 space-y-1">
        <MetaLine mode={mode} windowLabel={windowLabel} />
        {subtext && <p className="num text-xs text-muted">{subtext}</p>}
      </div>
    </ClickableCard>
  );
}

export function IncomeBox({
  amount,
  mode,
  windowLabel,
  pastConfirmed,
  futureProjected,
  onClick,
}: {
  amount: number;
  mode: string;
  windowLabel: string;
  pastConfirmed: number;
  futureProjected: number;
  onClick: () => void;
}) {
  const showSplit = pastConfirmed > 0 && futureProjected > 0;
  const isEmpty = amount === 0;
  return (
    <ClickableCard
      onClick={onClick}
      ariaLabel={`Income breakdown for ${modeLabel(mode)} over ${windowLabel}`}
    >
      <div>
        <p className="label-sm">Income</p>
        <p className={`mt-3 text-foreground ${headlineCls}`}>
          {formatCurrency(amount)}
        </p>
      </div>
      <div className="mt-4 space-y-1">
        <MetaLine mode={mode} windowLabel={windowLabel} />
        {showSplit && (
          <p className="num text-xs text-muted">
            {formatCurrency(pastConfirmed)} received +{" "}
            {formatCurrency(futureProjected)} projected
          </p>
        )}
        {isEmpty && (
          <p className="text-xs text-muted">
            No income logged or projected in this window.
          </p>
        )}
      </div>
    </ClickableCard>
  );
}

export function CombinedBox({
  amount,
  isDeficit,
  mode,
  windowLabel,
  onClick,
}: {
  amount: number;
  isDeficit: boolean;
  mode: string;
  windowLabel: string;
  onClick: () => void;
}) {
  const ringCls = isDeficit
    ? "ring-2 ring-inset ring-deficit/40"
    : "ring-2 ring-inset ring-surplus/40";
  const tint = isDeficit
    ? "bg-deficit/5 border-deficit/30"
    : "bg-surplus/5 border-surplus/30";
  const valueCls = isDeficit ? "text-deficit" : "text-surplus";
  const caption = isDeficit ? "Deficit" : "Surplus";
  return (
    <ClickableCard
      onClick={onClick}
      className={`${tint} ${ringCls}`}
      ariaLabel={`Combined ${caption.toLowerCase()} breakdown for ${modeLabel(
        mode
      )} over ${windowLabel}`}
    >
      <div>
        <p className="label-sm">Combined</p>
        <p className={`mt-3 ${valueCls} ${combinedHeadlineCls}`}>
          {isDeficit ? "-" : "+"}
          {formatCurrency(Math.abs(amount))}
        </p>
        <p
          className={`mt-1.5 text-[11px] font-medium uppercase tracking-[0.14em] ${
            isDeficit ? "text-deficit/80" : "text-surplus/80"
          }`}
        >
          {caption}
        </p>
      </div>
      <div className="mt-4">
        <MetaLine mode={mode} windowLabel={windowLabel} />
      </div>
    </ClickableCard>
  );
}

export function CashProjectionBoxes({
  data,
  onOpenCash,
  onOpenIncome,
  onOpenCombined,
}: {
  data: CashProjectionResponse;
  onOpenCash: () => void;
  onOpenIncome: () => void;
  onOpenCombined: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <CashBox
        amount={data.cash.amount}
        mode={data.mode}
        windowLabel={data.window.label}
        subtext={
          data.cash.amount !== data.cash.starting_balance
            ? `Starting: ${formatCurrency(data.cash.starting_balance)}`
            : null
        }
        onClick={onOpenCash}
      />
      <IncomeBox
        amount={data.income.amount}
        mode={data.mode}
        windowLabel={data.window.label}
        pastConfirmed={data.income.past_portion_confirmed}
        futureProjected={data.income.future_portion_projected}
        onClick={onOpenIncome}
      />
      <CombinedBox
        amount={data.combined.amount}
        isDeficit={data.combined.is_deficit}
        mode={data.mode}
        windowLabel={data.window.label}
        onClick={onOpenCombined}
      />
    </div>
  );
}

export function CashProjectionSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="flex min-h-[200px] flex-col gap-3 p-6 sm:min-h-[220px]">
          <div className="h-3 w-16 animate-pulse rounded bg-border-subtle" />
          <div className="h-10 w-32 animate-pulse rounded bg-border-subtle" />
          <div className="mt-auto h-3 w-24 animate-pulse rounded bg-border-subtle" />
        </Card>
      ))}
    </div>
  );
}
