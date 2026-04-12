import { formatCurrency } from "@/lib/format";

interface Props {
  current: number;
  target: number;
  percent: number;
  size?: "sm" | "md" | "lg";
  onTrack?: boolean | null;
}

export function GoalProgress({ current, target, percent, size = "md", onTrack }: Props) {
  const height = size === "lg" ? "h-3" : size === "sm" ? "h-1.5" : "h-2";
  const color =
    percent >= 100
      ? "bg-surplus"
      : onTrack === false
        ? "bg-warning"
        : "bg-terracotta";

  return (
    <div>
      <div className={`w-full overflow-hidden rounded-full bg-border-subtle ${height}`}>
        <div
          className={`${color} ${height} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      {size !== "sm" && (
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-muted num">
            {formatCurrency(current)} of {formatCurrency(target)}
          </span>
          <span
            className={`font-medium num ${
              percent >= 100
                ? "text-surplus"
                : onTrack === false
                  ? "text-warning"
                  : "text-foreground"
            }`}
          >
            {Math.round(percent)}%
          </span>
        </div>
      )}
    </div>
  );
}
