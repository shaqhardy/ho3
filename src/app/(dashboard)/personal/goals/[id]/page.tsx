import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { GoalDetail } from "@/components/goals/goal-detail";

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: goal } = await supabase
    .from("goals")
    .select("*")
    .eq("id", id)
    .single();

  if (!goal) notFound();

  const { data: contributions } = await supabase
    .from("goal_contributions")
    .select("*")
    .eq("goal_id", id)
    .order("date", { ascending: false });

  let linkedAccount = null;
  let linkedAccountName = null;
  if (goal.linked_account_id) {
    const { data } = await supabase
      .from("accounts")
      .select("id, name, current_balance")
      .eq("id", goal.linked_account_id)
      .single();
    if (data) {
      linkedAccount = { id: data.id, current_balance: data.current_balance };
      linkedAccountName = data.name;
    }
  }

  let linkedDebt = null;
  let linkedDebtName = null;
  if (goal.linked_debt_id) {
    const { data } = await supabase
      .from("debts")
      .select("id, creditor, current_balance, original_balance")
      .eq("id", goal.linked_debt_id)
      .single();
    if (data) {
      linkedDebt = {
        id: data.id,
        current_balance: data.current_balance,
        original_balance: data.original_balance,
      };
      linkedDebtName = data.creditor;
    }
  }

  return (
    <div className="has-bottom-nav space-y-6">
      <GoalDetail
        goal={goal}
        contributions={contributions || []}
        linkedAccount={linkedAccount}
        linkedDebt={linkedDebt}
        linkedAccountName={linkedAccountName}
        linkedDebtName={linkedDebtName}
      />
    </div>
  );
}
