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
 * Clickable wrapper around the projection boxes. role=button + keyboard
 * handlers + hover affordance + info icon top-right to telegraph "click me".
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
        className={`transition-transform group-hover:-translate-y-[1px] ${className}`}
      >
        <span
          aria-hidden
          className="absolute right-3 top-3 text-muted opacity-60 transition-opacity group-hover:opacity-100"
        >
          <Info className="h-3.5 w-3.5" />
        </span>
        {children}
      </Card>
    </div>
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
      <p className="label-sm">Cash</p>
      <p className="display-value text-foreground">{formatCurrency(amount)}</p>
      <p className="mt-1 text-xs text-muted">
        {modeLabel(mode)} · {windowLabel}
      </p>
      {subtext && <p className="text-xs text-muted num">{subtext}</p>}
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
  return (
    <ClickableCard
      onClick={onClick}
      ariaLabel={`Income breakdown for ${modeLabel(mode)} over ${windowLabel}`}
    >
      <p className="label-sm">Income</p>
      <p className="display-value text-foreground">{formatCurrency(amount)}</p>
      <p className="mt-1 text-xs text-muted">
        {modeLabel(mode)} · {windowLabel}
      </p>
      {showSplit && (
        <p className="text-xs text-muted num">
          {formatCurrency(pastConfirmed)} received +{" "}
          {formatCurrency(futureProjected)} projected
        </p>
      )}
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
  const tint = isDeficit
    ? "bg-deficit/10 border-deficit/40"
    : "bg-surplus/10 border-surplus/40";
  const valueCls = isDeficit ? "text-deficit" : "text-surplus";
  const label = isDeficit ? "Deficit" : "Surplus";
  return (
    <ClickableCard
      onClick={onClick}
      className={tint}
      ariaLabel={`${label} breakdown for ${modeLabel(mode)} over ${windowLabel}`}
    >
      <p className="label-sm">{label}</p>
      <p className={`display-value ${valueCls}`}>
        {isDeficit ? "-" : "+"}
        {formatCurrency(Math.abs(amount))}
      </p>
      <p className="mt-1 text-xs text-muted">
        {modeLabel(mode)} · {windowLabel}
      </p>
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
        <Card key={i} className="flex flex-col gap-2">
          <div className="h-3 w-16 animate-pulse rounded bg-border-subtle" />
          <div className="h-9 w-32 animate-pulse rounded bg-border-subtle" />
          <div className="h-3 w-24 animate-pulse rounded bg-border-subtle" />
        </Card>
      ))}
    </div>
  );
}
