import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { WhatIfView } from "@/components/whatif-view";

export default async function NonprofitWhatIfPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const today = new Date().toISOString().split("T")[0];

  const [
    { data: accounts },
    { data: bills },
    { data: subscriptions },
    { data: debts },
    { data: projectedIncome },
    { data: categories },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("book", "nonprofit")
      .order("name"),
    supabase
      .from("bills")
      .select("*")
      .eq("book", "nonprofit")
      .eq("status", "upcoming")
      .order("due_date"),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("book", "nonprofit")
      .eq("is_active", true)
      .order("next_charge_date"),
    supabase.from("debts").select("*").eq("book", "nonprofit"),
    supabase
      .from("projected_income")
      .select("*")
      .eq("book", "nonprofit")
      .gte("date", today)
      .order("date"),
    supabase
      .from("categories")
      .select("*")
      .eq("book", "nonprofit")
      .order("name"),
  ]);

  const currentCash = (accounts || [])
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + Number(a.current_balance), 0);

  return (
    <WhatIfView
      book="nonprofit"
      bookLabel="Nonprofit"
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
