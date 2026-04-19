import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OverviewDashboard } from "@/components/overview-dashboard";
import { fetchAllPaginated } from "@/lib/supabase/paginate";
import type { MonthlyFlowRow } from "@/components/charts/net-worth-trend";
import type { IncomeEntry } from "@/lib/types";

type TrendsTxnRow = Parameters<
  typeof OverviewDashboard
>[0]["trendsTxns"] extends (infer U)[] | undefined
  ? U
  : never;

export default async function OverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/personal");
  }

  const trendsSince = new Date();
  trendsSince.setMonth(trendsSince.getMonth() - 13);
  const trendsSinceYmd = trendsSince.toISOString().slice(0, 10);

  // Income chart looks back 12 months from the 1st of the oldest displayed
  // month — so a 12-month bar for, say, May → May shows a full May bar.
  const incomeSince = new Date();
  incomeSince.setMonth(incomeSince.getMonth() - 11);
  incomeSince.setDate(1);
  const incomeSinceYmd = incomeSince.toISOString().slice(0, 10);

  const [
    { data: accounts },
    { data: bills },
    { data: subscriptions },
    { data: debts },
    { data: recentTransactions },
    { data: flows },
    trendsTxns,
    incomeEntries,
    unconfirmedIncome,
  ] = await Promise.all([
    supabase.from("accounts").select("*").eq("is_hidden", false).order("book"),
    supabase
      .from("bills")
      .select("*")
      .eq("status", "upcoming")
      .order("due_date")
      .limit(20),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("is_active", true)
      .order("next_charge_date")
      .limit(20),
    supabase.from("debts").select("*"),
    supabase
      .from("transactions")
      .select("*")
      .order("date", { ascending: false })
      .limit(20),
    // Net worth trend: aggregated server-side so 13 months of history never
    // blows past the row cap regardless of transaction volume.
    supabase.rpc("monthly_flows", {
      p_books: ["personal", "business", "nonprofit"],
      p_since: trendsSinceYmd,
    }),
    // Category donut still needs per-row data for its client-side window
    // picker (7/30/90/YTD/12mo). Paginate so we never truncate at 1000.
    fetchAllPaginated<TrendsTxnRow>((from, to) =>
      supabase
        .from("transactions")
        .select(
          "id, book, date, amount, is_income, account_id, split_parent_id"
        )
        .gte("date", trendsSinceYmd)
        .order("date", { ascending: true })
        .range(from, to)
    ),
    // Income ledger. Paginated — reuses the same helper we just introduced
    // for the unbounded-read fix. Confirmed-only for the chart and totals.
    fetchAllPaginated<IncomeEntry>((from, to) =>
      supabase
        .from("income_entries")
        .select("*")
        .eq("is_confirmed", true)
        .gte("received_date", incomeSinceYmd)
        .order("received_date", { ascending: false })
        .range(from, to)
    ),
    // Pending Plaid-detected entries for the Unconfirmed Income widget. No
    // date filter — old pending entries should stay visible until handled.
    fetchAllPaginated<IncomeEntry>((from, to) =>
      supabase
        .from("income_entries")
        .select("*")
        .eq("is_confirmed", false)
        .order("received_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
  ]);

  return (
    <OverviewDashboard
      accounts={accounts || []}
      bills={bills || []}
      subscriptions={subscriptions || []}
      debts={debts || []}
      recentTransactions={recentTransactions || []}
      trendsTxns={trendsTxns ?? []}
      monthlyFlows={(flows ?? []) as MonthlyFlowRow[]}
      incomeEntries={incomeEntries ?? []}
      unconfirmedIncome={unconfirmedIncome ?? []}
    />
  );
}
