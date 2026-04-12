import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SettingsView } from "@/components/settings-view";

export default async function SettingsPage() {
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

  const { data: preferences } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, enabled, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Fetch per-account thresholds for the advanced section.
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, book, current_balance, low_balance_threshold")
    .order("name", { ascending: true });

  // Fetch debts for custom milestone thresholds.
  const { data: debts } = await supabase
    .from("debts")
    .select(
      "id, creditor, nickname, current_balance, original_balance, custom_milestone_threshold, book"
    )
    .order("creditor", { ascending: true });

  // Check if user has budgets / goals for disabled-state UX.
  const [{ count: budgetCount }, { count: goalCount }] = await Promise.all([
    supabase
      .from("budgets")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("goals")
      .select("*", { count: "exact", head: true }),
  ]);

  return (
    <SettingsView
      profile={profile}
      preferences={preferences}
      subscriptions={subscriptions || []}
      accounts={accounts || []}
      debts={debts || []}
      hasBudgets={(budgetCount ?? 0) > 0}
      hasGoals={(goalCount ?? 0) > 0}
    />
  );
}
