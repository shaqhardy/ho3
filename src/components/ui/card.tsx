import type { CSSProperties } from "react";

type AccentColor =
  | "terracotta"
  | "surplus"
  | "deficit"
  | "warning"
  | "blue"
  | "green"
  | "none";

const accentBarColor: Record<AccentColor, string> = {
  terracotta: "bg-terracotta",
  surplus: "bg-surplus",
  deficit: "bg-deficit",
  warning: "bg-warning",
  blue: "bg-accent-blue",
  green: "bg-accent-green",
  none: "",
};

export function Card({
  children,
  className = "",
  accent = "none",
  interactive = false,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: AccentColor;
  interactive?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`card-depth relative overflow-hidden rounded-xl border border-border-subtle bg-card p-5 ${
        interactive ? "transition-colors hover:bg-card-hover" : ""
      } ${className}`}
    >
      {accent !== "none" && (
        <span
          aria-hidden
          className={`absolute left-0 top-0 h-full w-[3px] ${accentBarColor[accent]}`}
        />
      )}
      {children}
    </div>
  );
}

export function ElevatedCard({
  children,
  className = "",
  accent = "terracotta",
}: {
  children: React.ReactNode;
  className?: string;
  accent?: AccentColor;
}) {
  return (
    <div
      className={`card-elevated-depth relative overflow-hidden rounded-2xl border border-border bg-card-elevated p-6 sm:p-7 ${className}`}
    >
      {accent !== "none" && (
        <span
          aria-hidden
          className={`absolute left-0 top-0 h-full w-[4px] ${accentBarColor[accent]}`}
        />
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 90% 0%, rgba(204,85,0,0.06), transparent 70%)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

const valueColorClass: Record<string, string> = {
  default: "text-foreground",
  surplus: "text-surplus",
  deficit: "text-deficit",
  warning: "text-warning",
  terracotta: "text-terracotta",
  muted: "text-muted",
};

export function StatCard({
  label,
  value,
  subtext,
  color = "text-foreground",
  accent = "none",
  size = "default",
  className = "",
}: {
  label: string;
  value: string;
  subtext?: string;
  color?: string;
  accent?: AccentColor;
  size?: "default" | "lg";
  className?: string;
}) {
  const valueClass = size === "lg" ? "hero-value" : "display-value";
  return (
    <Card accent={accent} className={className}>
      <p className="label-sm">{label}</p>
      <p className={`mt-2 ${valueClass} ${color}`}>{value}</p>
      {subtext && (
        <p className="mt-1.5 text-xs text-muted num">{subtext}</p>
      )}
    </Card>
  );
}

export { valueColorClass };
