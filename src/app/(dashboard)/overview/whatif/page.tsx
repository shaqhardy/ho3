import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { WhatIfView } from "@/components/whatif-view";

export default async function OverviewWhatIfPage() {
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

  const today = new Date().toISOString().split("T")[0];

  const [
    { data: accounts },
    { data: bills },
    { data: subscriptions },
    { data: debts },
    { data: projectedIncome },
    { data: categories },
  ] = await Promise.all([
    supabase.from("accounts").select("*").order("book"),
    supabase
      .from("bills")
      .select("*")
      .eq("status", "upcoming")
      .order("due_date"),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("is_active", true)
      .order("next_charge_date"),
    supabase.from("debts").select("*"),
    supabase
      .from("projected_income")
      .select("*")
      .gte("date", today)
      .order("date"),
    supabase.from("categories").select("*").order("name"),
  ]);

  const currentCash = (accounts || [])
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + Number(a.current_balance), 0);

  return (
    <WhatIfView
      book="cross-book"
      bookLabel="All books"
      currentCash={currentCash}
      bills={bills || []}
      subscriptions={subscriptions || []}
      debts={debts || []}
      projectedIncome={projectedIncome || []}
      categories={categories || []}
      accounts={accounts || []}
    />
  );
}
