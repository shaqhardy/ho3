import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// GET /api/accounts/[id]/balance-history
//
// Returns up to 365 days of {date, balance} points for this account. Prefers
// real snapshots from account_balance_snapshots. If fewer than 2 snapshots
// exist we fall back to a reverse-walk from the current balance using the
// transaction ledger — not exact, but close enough for a trend line.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use RLS to confirm access: if this query returns no row the user either
  // doesn't have access to the book or the id is bogus. Either way, 404.
  const { data: account } = await supabase
    .from("accounts")
    .select("id, book, type, current_balance")
    .eq("id", id)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = await createServiceClient();

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 365);
  const sinceYmd = sinceDate.toISOString().slice(0, 10);

  const { data: snapshots } = await admin
    .from("account_balance_snapshots")
    .select("snapshot_date, current_balance")
    .eq("account_id", id)
    .gte("snapshot_date", sinceYmd)
    .order("snapshot_date", { ascending: true })
    .limit(500);

  if (snapshots && snapshots.length >= 2) {
    return NextResponse.json({
      source: "snapshots",
      points: snapshots.map((s) => ({
        date: s.snapshot_date as string,
        balance: Number(s.current_balance ?? 0),
      })),
    });
  }

  // Fallback: derive from transactions.
  const { data: txns } = await admin
    .from("transactions")
    .select("date, amount, is_income")
    .eq("account_id", id)
    .gte("date", sinceYmd)
    .order("date", { ascending: true });

  const liability = account.type === "credit" || account.type === "loan";
  const current = liability
    ? Math.abs(Number(account.current_balance ?? 0))
    : Number(account.current_balance ?? 0);

  // Build a per-day delta map, then walk backwards from today to fabricate
  // the series.
  const deltaByDay = new Map<string, number>();
  for (const t of txns ?? []) {
    const amt = Math.abs(Number(t.amount ?? 0));
    const delta = liability
      ? t.is_income
        ? -amt
        : amt
      : t.is_income
        ? amt
        : -amt;
    deltaByDay.set(
      t.date as string,
      (deltaByDay.get(t.date as string) ?? 0) + delta
    );
  }

  const today = new Date();
  const points: { date: string; balance: number }[] = [];
  let running = current;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    points.push({ date: ymd, balance: running });
    running -= deltaByDay.get(ymd) ?? 0;
  }
  points.reverse();

  return NextResponse.json({ source: "derived", points });
}
