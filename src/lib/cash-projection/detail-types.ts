import type { Book, IncomeClassification } from "@/lib/types";

export interface DetailAccountRow {
  id: string;
  book: Book;
  name: string;
  nickname: string | null;
  mask: string | null;
  subtype: string | null;
  current_balance: number;
  available_balance: number | null;
  last_synced_at: string | null;
}

export interface DetailIncomeLine {
  kind: "income_entry" | "projected_income";
  id: string;
  book: Book;
  date: string;
  amount: number;
  classification: IncomeClassification;
  source: string | null;
  linked_schedule_id: string | null;
  linked_transaction_id: string | null;
}

export interface DetailOutflowLine {
  kind:
    | "bill"
    | "budget_allocation"
    | "distribution_outflow"
    | "posted_expense";
  id: string;
  book: Book;
  name: string;
  amount: number;
  date_start: string;
  date_end: string | null;
  category_id: string | null;
  category_name: string | null;
  schedule_id: string | null;
  status: string | null;
}

export interface DetailBudgetSegment {
  label: string;
  amount: number;
}

export interface DetailBudgetAllocation {
  budget_id: string;
  budget_name: string;
  category_id: string | null;
  category_name: string | null;
  book: Book;
  monthly_allocated: number;
  segments: DetailBudgetSegment[];
  subtotal: number;
  bill_dedup_applied: number;
  final_total: number;
}

export interface DetailBillRow {
  id: string;
  book: Book;
  name: string;
  amount: number;
  due_date: string;
  status: string;
  category_id: string | null;
  category_name: string | null;
}

export interface DetailDistributionOutflow {
  schedule_id: string;
  date: string;
  amount: number;
  source_book: Book;
  target_book: Book;
  notes: string | null;
}

export interface DetailDedupMatch {
  bill_id: string;
  bill_name: string;
  bill_amount: number;
  category_id: string;
  category_name: string;
}

export interface CashProjectionDetail {
  cash: {
    starting_balance: {
      accounts: DetailAccountRow[];
      total: number;
    };
    inflows: {
      entries: DetailIncomeLine[];
      subtotal: number;
    };
    outflows: {
      entries: DetailOutflowLine[];
      subtotal: number;
    };
  };
  income: {
    past: {
      entries: DetailIncomeLine[];
      subtotal: number;
      excluded_owner_distributions_count: number;
      excluded_owner_distributions_amount: number;
    };
    future: {
      entries: DetailIncomeLine[];
      subtotal: number;
      excluded_owner_distributions_count: number;
      excluded_owner_distributions_amount: number;
    };
  };
  expenses: {
    bills: DetailBillRow[];
    bills_subtotal: number;
    budget_allocations: DetailBudgetAllocation[];
    budget_allocations_subtotal: number;
    distribution_outflows: DetailDistributionOutflow[];
    distribution_outflows_subtotal: number;
    dedup_applied: DetailDedupMatch[];
    grand_total: number;
  };
}
