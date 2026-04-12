import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CatchupMode } from "@/components/personal/catchup-mode";

export default async function CatchupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: debts }, { data: accounts }, { data: projectedIncome }] =
    await Promise.all([
      supabase
        .from("debts")
        .select("*")
        .eq("book", "personal")
        .gt("current_balance", 0)
        .order("current_balance", { ascending: false }),
      supabase
        .from("accounts")
        .select("*")
        .eq("book", "personal")
        .eq("type", "depository"),
      supabase
        .from("projected_income")
        .select("*")
        .eq("book", "personal")
        .gte("date", new Date().toISOString().split("T")[0])
        .order("date"),
    ]);

  return (
    <CatchupMode
      debts={debts || []}
      accounts={accounts || []}
      projectedIncome={projectedIncome || []}
    />
  );
}
