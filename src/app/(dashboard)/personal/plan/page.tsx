import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PlanView } from "@/components/personal/plan-view";

export default async function PlanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [
    { data: accounts },
    { data: bills },
    { data: subscriptions },
    { data: debts },
    { data: projectedIncome },
    { data: planOverrides },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("book", "personal")
      .eq("type", "depository"),
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
      .gte("date", new Date().toISOString().split("T")[0])
      .order("date"),
    supabase
      .from("plan_overrides")
      .select("*")
      .eq("user_id", user.id),
  ]);

  return (
    <PlanView
      accounts={accounts || []}
      bills={bills || []}
      subscriptions={subscriptions || []}
      debts={debts || []}
      projectedIncome={projectedIncome || []}
      planOverrides={planOverrides || []}
      userId={user.id}
    />
  );
}
