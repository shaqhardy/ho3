import type { IncomeClassification } from "@/lib/types";
import type { CashProjectionDetail } from "@/lib/cash-projection/detail-types";

export type CashWindow = "month" | "quarter" | "6mo" | "9mo" | "year" | "ytd";
export type CashMode = "live" | "scheduled" | "projected";
export type BookScope = "personal" | "business" | "nonprofit" | "all";

export interface CashProjectionResponse {
  cash: {
    amount: number;
    starting_balance: number;
    source_breakdown: Record<string, number>;
  };
  income: {
    amount: number;
    past_portion_confirmed: number;
    future_portion_projected: number;
    breakdown_by_classification: Record<IncomeClassification, number>;
  };
  combined: {
    amount: number;
    is_deficit: boolean;
  };
  expected_expenses: {
    bills_total: number;
    budget_allocations_total: number;
    posted_expenses_total: number;
    owner_distribution_outflows: number;
    deduplicated_total: number;
  };
  window: { start: string; end: string; label: string };
  mode: CashMode;
  book_scope: string;
  detail?: CashProjectionDetail;
}

export const CASH_WINDOWS: { value: CashWindow; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "6mo", label: "6 Months" },
  { value: "9mo", label: "9 Months" },
  { value: "year", label: "Year" },
  { value: "ytd", label: "YTD" },
];

export const CASH_MODES: { value: CashMode; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "scheduled", label: "Scheduled" },
  { value: "projected", label: "Projected" },
];
