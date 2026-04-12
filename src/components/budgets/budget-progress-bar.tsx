import { formatCurrency } from "@/lib/format";

type Size = "sm" | "md" | "lg";

interface Props {
  spent: number;
  allocated: number;
  size?: Size;
  showText?: boolean;
  label?: string;
}

/**
 * Reusable progress bar with color semantics:
 *   green  < 80%
 *   yellow 80%-100%
 *   red    > 100% (over budget)
 */
export function BudgetProgressBar({
  spent,
  allocated,
  size = "md",
  showText = true,
  label,
}: Props) {
  const pct = allocated > 0 ? (spent / allocated) * 100 : 0;
  const clamped = Math.min(100, Math.max(0, pct));

  let barColor = "bg-surplus";
  let textColor = "text-surplus";
  if (pct >= 100) {
    barColor = "bg-deficit";
    textColor = "text-deficit";
  } else if (pct >= 80) {
    barColor = "bg-warning";
    textColor = "text-warning";
  }

  const height =
    size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";
  const valueSize =
    size === "sm" ? "text-xs" : size === "lg" ? "text-sm" : "text-xs";

  return (
    <div className="w-full">
      {showText && (
        <div
          className={`mb-1 flex items-baseline justify-between ${valueSize} num`}
        >
          <span className="text-muted">
            {label ? `${label} ` : ""}
            {formatCurrency(spent)} of {formatCurrency(allocated)}
          </span>
          <span className={`font-medium ${textColor}`}>
            {pct.toFixed(0)}%
          </span>
        </div>
      )}
      <div
        className={`relative w-full overflow-hidden rounded-full bg-border-subtle ${height}`}
      >
        <div
          className={`${barColor} ${height} rounded-full transition-[width]`}
          style={{ width: `${clamped}%` }}
        />
        {pct > 100 && (
          <span
            aria-hidden
            className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-white"
          >
            OVER
          </span>
        )}
      </div>
    </div>
  );
}
