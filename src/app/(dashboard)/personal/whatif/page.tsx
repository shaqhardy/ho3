import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { WhatIfView } from "@/components/whatif-view";

export default async function PersonalWhatIfPage() {
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
      .eq("book", "personal")
      .order("name"),
    supabase
      .from("bills")
      .select("*")
      .eq("book", "personal")
      .eq("status", "upcoming")
      .order("due_date"),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("book", "personal")
      .eq("is_active", true)
      .order("next_charge_date"),
    supabase.from("debts").select("*").eq("book", "personal"),
    supabase
      .from("projected_income")
      .select("*")
      .eq("book", "personal")
      .gte("date", today)
      .order("date"),
    supabase
      .from("categories")
      .select("*")
      .eq("book", "personal")
      .order("name"),
  ]);

  const currentCash = (accounts || [])
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + Number(a.current_balance), 0);

  return (
    <WhatIfView
      book="personal"
      bookLabel="Personal"
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
