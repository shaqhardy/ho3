import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PersonalDashboard } from "@/components/personal/dashboard";
import { CashProjectionSection } from "@/components/cash-projection/cash-projection-section";

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
      .eq("is_hidden", false)
      .order("name"),
    supabase
      .from("transactions")
      .select("*, categories(name)")
      .eq("book", "personal")
      .order("date", { ascending: false })
      .limit(5000),
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

  const hasData =
    (accounts?.length ?? 0) > 0 ||
    (transactions?.length ?? 0) > 0 ||
    (bills?.length ?? 0) > 0 ||
    (subscriptions?.length ?? 0) > 0 ||
    (debts?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <CashProjectionSection book="personal" hasData={hasData} />
      <PersonalDashboard
        accounts={accounts || []}
        transactions={transactions || []}
        bills={bills || []}
        subscriptions={subscriptions || []}
        debts={debts || []}
        categories={categories || []}
        projectedIncome={projectedIncome || []}
      />
    </div>
  );
}
