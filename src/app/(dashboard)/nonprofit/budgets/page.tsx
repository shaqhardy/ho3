import { redirect } from "next/navigation";
import { BudgetsList } from "@/components/budgets/budgets-list";
import { loadBudgetsForBook } from "@/lib/budgets/load";
import { BOOK_LABELS } from "@/lib/books";

export const dynamic = "force-dynamic";

export default async function NonprofitBudgetsPage() {
  const data = await loadBudgetsForBook("nonprofit");
  if (data === "unauthorized") redirect("/login");
  if (data === "forbidden") redirect("/nonprofit");

  return (
    <div className="has-bottom-nav space-y-6">
      <header>
        <p className="label-sm">{BOOK_LABELS.nonprofit}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Budgets
        </h1>
      </header>
      <BudgetsList
        budgets={data.budgets as unknown as Parameters<typeof BudgetsList>[0]["budgets"]}
        categories={data.categories as unknown as Parameters<typeof BudgetsList>[0]["categories"]}
        book="nonprofit"
        suggestions={
          data.suggestions as unknown as Parameters<
            typeof BudgetsList
          >[0]["suggestions"]
        }
      />
    </div>
  );
}
