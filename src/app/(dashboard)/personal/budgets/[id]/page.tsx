import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { BudgetDetail } from "@/components/budgets/budget-detail";
import { currentPeriodRange } from "@/lib/budgets/compute";

export default async function BudgetDetailPage({
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

  const { data: budget } = await supabase
    .from("budgets")
    .select("*, budget_categories(*)")
    .eq("id", id)
    .single();

  if (!budget) notFound();

  const [{ data: categories }, { data: periods }] = await Promise.all([
    supabase.from("categories").select("*").eq("book", budget.book),
    supabase
      .from("budget_periods")
      .select("*")
      .eq("budget_id", id)
      .order("period_start", { ascending: false }),
  ]);

  const range = currentPeriodRange(budget);
  const { data: transactions } = await supabase
    .from("transactions")
    .select("id, date, amount, category_id, merchant, description")
    .eq("book", budget.book)
    .eq("is_income", false)
    .gte("date", range.start.toISOString().split("T")[0])
    .lte("date", range.end.toISOString().split("T")[0])
    .order("date", { ascending: false });

  return (
    <div className="has-bottom-nav space-y-6">
      <BudgetDetail
        budget={budget}
        categories={categories || []}
        transactions={transactions || []}
        periods={periods || []}
      />
    </div>
  );
}
