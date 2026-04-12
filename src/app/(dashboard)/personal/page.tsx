import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PersonalDashboard } from "@/components/personal/dashboard";

export default async function PersonalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [
    { data: accounts },
    { data: transactions },
    { data: bills },
    { data: subscriptions },
    { data: debts },
    { data: categories },
    { data: projectedIncome },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("book", "personal")
      .order("name"),
    supabase
      .from("transactions")
      .select("*, categories(name)")
      .eq("book", "personal")
      .order("date", { ascending: false })
      .limit(100),
    supabase
      .from("bills")
      .select("*")
      .eq("book", "personal")
      .order("due_date"),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("book", "personal")
      .order("next_charge_date"),
    supabase.from("debts").select("*").eq("book", "personal"),
    supabase
      .from("categories")
      .select("*")
      .eq("book", "personal")
      .order("name"),
    supabase
      .from("projected_income")
      .select("*")
      .eq("book", "personal")
      .order("date"),
  ]);

  return (
    <PersonalDashboard
      accounts={accounts || []}
      transactions={transactions || []}
      bills={bills || []}
      subscriptions={subscriptions || []}
      debts={debts || []}
      categories={categories || []}
      projectedIncome={projectedIncome || []}
    />
  );
}
