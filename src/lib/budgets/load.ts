import { createClient, createServiceClient } from "@/lib/supabase/server";
import { currentPeriodRange } from "@/lib/budgets/compute";
import type { Book } from "@/lib/types";

export async function loadBudgetsForBook(book: Book) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "unauthorized" as const;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  if (
    profile?.role !== "admin" &&
    !(profile?.allowed_books ?? []).includes(book)
  )
    return "forbidden" as const;

  const admin = await createServiceClient();

  const [{ data: budgets }, { data: categories }, { data: transactions }, { data: suggestions }] =
    await Promise.all([
      supabase
        .from("budgets")
        .select("*, budget_categories(*)")
        .eq("book", book)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("categories")
        .select("*")
        .eq("book", book)
        .order("name"),
      supabase
        .from("transactions")
        .select("id, date, amount, category_id, book, is_income")
        .eq("book", book)
        .eq("is_income", false)
        .gte(
          "date",
          new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1)
            .toISOString()
            .split("T")[0]
        ),
      admin
        .from("budget_suggestions")
        .select(
          "*, budget_categories:budget_category_id(category_id, categories(name)), budgets:budget_id(book)"
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

  type BudgetRow = {
    id: string;
    book: Book;
    period: import("@/lib/types").BudgetPeriodType;
    period_start_date: string | null;
    period_end_date: string | null;
    budget_categories?: Array<{
      category_id: string;
      allocated_amount: number | string;
    }>;
  };

  const budgetsWithSummary = ((budgets ?? []) as BudgetRow[]).map((b) => {
    const range = currentPeriodRange(b);
    const catIds = new Set(
      (b.budget_categories || []).map((bc) => bc.category_id)
    );
    const spent = (transactions || [])
      .filter(
        (t) =>
          t.category_id &&
          catIds.has(t.category_id) &&
          t.date >= range.start.toISOString().split("T")[0] &&
          t.date <= range.end.toISOString().split("T")[0]
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const allocated = (b.budget_categories || []).reduce(
      (sum: number, bc) => sum + Number(bc.allocated_amount),
      0
    );
    return {
      ...b,
      current_period_spent: spent,
      current_period_allocated: allocated,
    };
  });

  // Only suggestions for this book.
  const bookSuggestions = ((suggestions ?? []) as unknown as Array<{
    budgets?: { book: Book } | null;
  }>).filter((s) => s.budgets?.book === book);

  return {
    budgets: budgetsWithSummary,
    categories: categories ?? [],
    suggestions: bookSuggestions,
  } as const;
}
