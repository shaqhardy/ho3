"use client";

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

export function CashBox({
  amount,
  mode,
  windowLabel,
  subtext,
}: {
  amount: number;
  mode: string;
  windowLabel: string;
  subtext?: string | null;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="label-sm">Cash</p>
      <p className="display-value text-foreground">{formatCurrency(amount)}</p>
      <p className="text-xs text-muted">
        {modeLabel(mode)} · {windowLabel}
      </p>
      {subtext && <p className="text-xs text-muted num">{subtext}</p>}
    </Card>
  );
}

export function IncomeBox({
  amount,
  mode,
  windowLabel,
  pastConfirmed,
  futureProjected,
}: {
  amount: number;
  mode: string;
  windowLabel: string;
  pastConfirmed: number;
  futureProjected: number;
}) {
  const showSplit = pastConfirmed > 0 && futureProjected > 0;
  return (
    <Card className="flex flex-col gap-1">
      <p className="label-sm">Income</p>
      <p className="display-value text-foreground">{formatCurrency(amount)}</p>
      <p className="text-xs text-muted">
        {modeLabel(mode)} · {windowLabel}
      </p>
      {showSplit && (
        <p className="text-xs text-muted num">
          {formatCurrency(pastConfirmed)} received +{" "}
          {formatCurrency(futureProjected)} projected
        </p>
      )}
    </Card>
  );
}

export function CombinedBox({
  amount,
  isDeficit,
  mode,
  windowLabel,
}: {
  amount: number;
  isDeficit: boolean;
  mode: string;
  windowLabel: string;
}) {
  const tint = isDeficit
    ? "bg-deficit/10 border-deficit/40"
    : "bg-surplus/10 border-surplus/40";
  const valueCls = isDeficit ? "text-deficit" : "text-surplus";
  const label = isDeficit ? "Deficit" : "Surplus";
  return (
    <Card className={`flex flex-col gap-1 ${tint}`}>
      <p className="label-sm">{label}</p>
      <p className={`display-value ${valueCls}`}>
        {isDeficit ? "-" : "+"}
        {formatCurrency(Math.abs(amount))}
      </p>
      <p className="text-xs text-muted">
        {modeLabel(mode)} · {windowLabel}
      </p>
    </Card>
  );
}

export function CashProjectionBoxes({
  data,
}: {
  data: CashProjectionResponse;
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
      />
      <IncomeBox
        amount={data.income.amount}
        mode={data.mode}
        windowLabel={data.window.label}
        pastConfirmed={data.income.past_portion_confirmed}
        futureProjected={data.income.future_portion_projected}
      />
      <CombinedBox
        amount={data.combined.amount}
        isDeficit={data.combined.is_deficit}
        mode={data.mode}
        windowLabel={data.window.label}
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
