import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book } from "@/lib/types";

export interface CompletenessStat {
  total: number;
  categorized: number;
  uncategorized: number;
  /** Percent of categorizable transactions (excluding pure transfers and
   *  income — those are intentionally left without an expense category). */
  pct_of_expenses: number;
  expense_total: number;
  expense_uncategorized: number;
}

/**
 * The "% categorized" stat. We compute it against expenses only — transfers
 * and income are never budgeted categories, so counting them against the
 * total would dilute the signal the user actually cares about.
 */
export async function categorizationCompleteness(
  admin: SupabaseClient,
  book: Book
): Promise<CompletenessStat> {
  const [{ count: total }, { count: categorized }, { count: expenseTotal }, { count: expenseUncat }] =
    await Promise.all([
      admin
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("book", book),
      admin
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("book", book)
        .not("category_id", "is", null),
      admin
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("book", book)
        .eq("is_income", false)
        .not("pfc_primary", "in", "(TRANSFER_IN,TRANSFER_OUT)"),
      admin
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("book", book)
        .eq("is_income", false)
        .not("pfc_primary", "in", "(TRANSFER_IN,TRANSFER_OUT)")
        .is("category_id", null),
    ]);

  const t = total ?? 0;
  const cat = categorized ?? 0;
  const eTot = expenseTotal ?? 0;
  const eUncat = expenseUncat ?? 0;
  return {
    total: t,
    categorized: cat,
    uncategorized: t - cat,
    pct_of_expenses: eTot > 0 ? Math.round(((eTot - eUncat) / eTot) * 100) : 100,
    expense_total: eTot,
    expense_uncategorized: eUncat,
  };
}
