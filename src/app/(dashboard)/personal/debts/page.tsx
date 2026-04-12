import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DebtModule } from "@/components/personal/debt-module";

export default async function DebtsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: debts }, { data: statements }] = await Promise.all([
    supabase
      .from("debts")
      .select("*")
      .eq("book", "personal")
      .order("current_balance", { ascending: false }),
    supabase
      .from("debt_statements")
      .select("*")
      .order("statement_date", { ascending: false }),
  ]);

  return <DebtModule debts={debts || []} statements={statements || []} />;
}
