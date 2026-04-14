import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PlanView } from "@/components/personal/plan-view";
import type { Scenario } from "@/lib/projection/engine";
import { getBudgetContextForPlan } from "@/lib/budgets/plan-integration";
import type { Transaction, Budget, BudgetCategory, Category } from "@/lib/types";

export default async function PlanPage() {
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
    { data: planOverrides },
    scenariosRes,
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
      .gte("date", today)
      .order("date"),
    supabase.from("plan_overrides").select("*").eq("user_id", user.id),
    // Scenarios table may or may not exist yet — tolerate errors gracefully.
    supabase.from("scenarios").select("*").eq("book", "personal"),
  ]);

  const scenarios = (scenariosRes?.data ?? []) as Scenario[];

  // Budget overage context: if the user is over 110% on a discretionary
  // category, the Plan view can highlight that so money decisions deprioritize
  // it. Quiet no-op when no active budget exists.
  const [{ data: activeBudgets }, { data: budgetTxns }, { data: allCats }] =
    await Promise.all([
      supabase
        .from("budgets")
        .select("*, budget_categories(*)")
        .eq("book", "personal")
        .eq("is_active", true),
      supabase
        .from("transactions")
        .select(
          "id, account_id, book, date, amount, merchant, description, category_id, is_income, plaid_transaction_id, created_at, notes, receipt_url"
        )
        .eq("book", "personal")
        .eq("is_income", false)
        .gte(
          "date",
          new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
            .toISOString()
            .split("T")[0]
        ),
      supabase.from("categories").select("id, name").eq("book", "personal"),
    ]);
  const budgetContext = getBudgetContextForPlan(
    (activeBudgets || []) as unknown as Array<
      Budget & { budget_categories?: BudgetCategory[] }
    >,
    (budgetTxns || []) as unknown as Transaction[],
    (allCats || []) as Pick<Category, "id" | "name">[]
  );

  return (
    <PlanView
      accounts={accounts || []}
      bills={bills || []}
      subscriptions={subscriptions || []}
      debts={debts || []}
      projectedIncome={projectedIncome || []}
      planOverrides={planOverrides || []}
      userId={user.id}
      scenarios={scenarios}
      budgetContext={budgetContext}
    />
  );
}
