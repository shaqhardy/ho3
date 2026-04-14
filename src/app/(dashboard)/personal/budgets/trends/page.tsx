import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { BudgetTrendsView } from "@/components/budgets/trends-view";

export const dynamic = "force-dynamic";

export default async function BudgetTrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>;
}) {
  const sp = await searchParams;
  const months = [3, 6, 12].includes(Number(sp.months))
    ? Number(sp.months)
    : 6;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = await createServiceClient();

  // Pull budgets with their current allocated amounts per category.
  const { data: budgets } = await admin
    .from("budgets")
    .select("id, name, period, book, is_active, budget_categories(category_id, allocated_amount)")
    .eq("book", "personal")
    .eq("is_active", true);

  const today = new Date();
  const since = new Date(today.getFullYear(), today.getMonth() - months, 1)
    .toISOString()
    .slice(0, 10);

  const { data: txns } = await admin
    .from("transactions")
    .select("date, amount, category_id, split_parent_id, is_income, book")
    .eq("book", "personal")
    .eq("is_income", false)
    .gte("date", since)
    .not("category_id", "is", null);

  const { data: categories } = await admin
    .from("categories")
    .select("id, name")
    .eq("book", "personal");

  return (
    <BudgetTrendsView
      months={months as 3 | 6 | 12}
      budgets={(budgets || []) as unknown as Parameters<typeof BudgetTrendsView>[0]["budgets"]}
      transactions={(txns || []) as unknown as Parameters<typeof BudgetTrendsView>[0]["transactions"]}
      categories={(categories || []) as { id: string; name: string }[]}
    />
  );
}
