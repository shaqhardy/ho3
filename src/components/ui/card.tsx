export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  subtext,
  color = "text-foreground",
}: {
  label: string;
  value: string;
  subtext?: string;
  color?: string;
}) {
  return (
    <Card>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {subtext && <p className="mt-1 text-xs text-muted">{subtext}</p>}
    </Card>
  );
}
