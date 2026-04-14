import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OverviewDashboard } from "@/components/overview-dashboard";

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

  const [
    { data: accounts },
    { data: bills },
    { data: subscriptions },
    { data: debts },
    { data: recentTransactions },
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
  ]);

  return (
    <OverviewDashboard
      accounts={accounts || []}
      bills={bills || []}
      subscriptions={subscriptions || []}
      debts={debts || []}
      recentTransactions={recentTransactions || []}
    />
  );
}
