import type {
  Budget,
  BudgetCategory,
  Category,
  Transaction,
} from "@/lib/types";
import { computeSpent } from "@/lib/budgets/compute";

export interface BudgetContextFlag {
  category_id: string;
  name: string;
  allocated: number;
  spent: number;
  overage: number;
  percent: number;
  budget_id: string;
  budget_name: string;
}

export interface BudgetPlanContext {
  overLimitCategories: BudgetContextFlag[];
  nearLimitCategories: BudgetContextFlag[];
}

type BudgetInput = Budget & { budget_categories?: BudgetCategory[] };

/**
 * Inspect active budgets against this period's transactions. Returns
 * lists of over-limit (>=100%) and near-limit (>=80% and <100%) categories
 * that the Plan view can use to render warning indicators.
 */
export function getBudgetContextForPlan(
  budgets: BudgetInput[],
  transactions: Transaction[],
  categories: Pick<Category, "id" | "name">[] = []
): BudgetPlanContext {
  const categoryNameById = new Map<string, string>();
  for (const c of categories) categoryNameById.set(c.id, c.name);

  const overLimitCategories: BudgetContextFlag[] = [];
  const nearLimitCategories: BudgetContextFlag[] = [];

  for (const budget of budgets) {
    if (!budget.is_active) continue;
    const cats = budget.budget_categories || [];
    if (cats.length === 0) continue;
    const spentMap = computeSpent(budget, transactions);

    for (const bc of cats) {
      const allocated = Number(bc.allocated_amount) || 0;
      if (allocated <= 0) continue;
      const spent = spentMap.get(bc.category_id) || 0;
      const percent = (spent / allocated) * 100;
      const name =
        categoryNameById.get(bc.category_id) || "Uncategorized";
      const flag: BudgetContextFlag = {
        category_id: bc.category_id,
        name,
        allocated,
        spent,
        overage: Math.max(0, spent - allocated),
        percent,
        budget_id: budget.id,
        budget_name: budget.name,
      };
      if (percent >= 100) {
        overLimitCategories.push(flag);
      } else if (percent >= 80) {
        nearLimitCategories.push(flag);
      }
    }
  }

  return { overLimitCategories, nearLimitCategories };
}
