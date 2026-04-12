import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { GoalsList } from "@/components/goals/goals-list";
import { computeGoalProgress } from "@/lib/goals/compute";

export default async function GoalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: goals },
    { data: accounts },
    { data: debts },
    { data: contributions },
  ] = await Promise.all([
    supabase
      .from("goals")
      .select("*")
      .eq("book", "personal")
      .order("created_at", { ascending: false }),
    supabase.from("accounts").select("*").eq("book", "personal"),
    supabase.from("debts").select("*").eq("book", "personal"),
    supabase.from("goal_contributions").select("goal_id, amount, date"),
  ]);

  const acctMap = new Map((accounts || []).map((a) => [a.id, a]));
  const debtMap = new Map((debts || []).map((d) => [d.id, d]));

  const enriched = (goals || []).map((g) => {
    const la = g.linked_account_id ? acctMap.get(g.linked_account_id) : null;
    const ld = g.linked_debt_id ? debtMap.get(g.linked_debt_id) : null;
    const contribs =
      contributions?.filter((c) => c.goal_id === g.id).map((c) => ({
        amount: c.amount,
        date: c.date,
      })) || [];
    const progress = computeGoalProgress(g, la, ld, contribs);
    return { ...g, progress };
  });

  return (
    <div className="has-bottom-nav space-y-6">
      <header>
        <p className="label-sm">Personal</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Goals
        </h1>
      </header>
      <GoalsList
        goals={enriched}
        accounts={accounts || []}
        debts={debts || []}
        book="personal"
      />
    </div>
  );
}
