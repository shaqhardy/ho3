import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BudgetsList } from "@/components/budgets/budgets-list";
import { currentPeriodRange } from "@/lib/budgets/compute";

export default async function BudgetsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: budgets }, { data: categories }, { data: transactions }] =
    await Promise.all([
      supabase
        .from("budgets")
        .select("*, budget_categories(*)")
        .eq("book", "personal")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("categories")
        .select("*")
        .eq("book", "personal")
        .order("name"),
      supabase
        .from("transactions")
        .select("id, date, amount, category_id, book, is_income")
        .eq("book", "personal")
        .eq("is_income", false)
        .gte(
          "date",
          new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1)
            .toISOString()
            .split("T")[0]
        ),
    ]);

  // Compute current-period spent per budget
  const budgetsWithSummary = (budgets || []).map((b) => {
    const range = currentPeriodRange(b);
    const catIds = new Set(
      (b.budget_categories || []).map(
        (bc: { category_id: string }) => bc.category_id
      )
    );
    const spent = (transactions || [])
      .filter(
        (t) =>
          catIds.has(t.category_id) &&
          t.date >= range.start.toISOString().split("T")[0] &&
          t.date <= range.end.toISOString().split("T")[0]
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const allocated = (b.budget_categories || []).reduce(
      (sum: number, bc: { allocated_amount: number }) =>
        sum + Number(bc.allocated_amount),
      0
    );
    return {
      ...b,
      current_period_spent: spent,
      current_period_allocated: allocated,
    };
  });

  return (
    <div className="has-bottom-nav space-y-6">
      <header>
        <p className="label-sm">Personal</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Budgets
        </h1>
      </header>
      <BudgetsList
        budgets={budgetsWithSummary}
        categories={categories || []}
        book="personal"
      />
    </div>
  );
}
