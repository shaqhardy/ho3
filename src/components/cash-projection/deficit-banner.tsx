"use client";

import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/format";

export function DeficitBanner({
  amount,
  windowLabel,
}: {
  amount: number;
  windowLabel: string;
}) {
  const magnitude = Math.abs(amount);
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-deficit/40 bg-deficit/10 p-3 text-sm text-deficit"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>
        <strong className="font-semibold num">
          Deficit of {formatCurrency(magnitude)}
        </strong>{" "}
        over the {windowLabel.toLowerCase()}. Review bills, income, or budget to
        close the gap.
      </p>
    </div>
  );
}
