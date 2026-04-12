export type Book = "personal" | "business" | "nonprofit";

export type PriorityTier = "1" | "2" | "3";

export type PayoffStrategy = "avalanche" | "snowball";

export type BillStatus = "upcoming" | "paid" | "overdue" | "skipped";

export type SubscriptionFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

export type ConfidenceLevel = "confirmed" | "expected" | "tentative";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "user";
  allowed_books: Book[];
  created_at: string;
}

export interface Account {
  id: string;
  book: Book;
  name: string;
  plaid_account_id: string | null;
  plaid_item_id: string | null;
  current_balance: number;
  available_balance: number | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  account_id: string;
  book: Book;
  date: string;
  amount: number;
  merchant: string | null;
  description: string | null;
  category_id: string | null;
  notes: string | null;
  receipt_url: string | null;
  plaid_transaction_id: string | null;
  is_income: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  book: Book;
  name: string;
  parent_id: string | null;
  icon: string | null;
  created_at: string;
}

export interface CategoryRule {
  id: string;
  merchant_pattern: string;
  category_id: string;
  book: Book;
  created_at: string;
}

export interface Bill {
  id: string;
  book: Book;
  name: string;
  amount: number;
  due_date: string;
  account_id: string | null;
  category_id: string | null;
  status: BillStatus;
  priority_tier: PriorityTier;
  is_recurring: boolean;
  frequency: SubscriptionFrequency | null;
  notes: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  book: Book;
  name: string;
  amount: number;
  next_charge_date: string;
  frequency: SubscriptionFrequency;
  account_id: string | null;
  category_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Debt {
  id: string;
  account_id: string | null;
  book: Book;
  creditor: string;
  nickname: string | null;
  current_balance: number;
  apr: number;
  minimum_payment: number;
  statement_due_date: string;
  payoff_strategy_override: PayoffStrategy | null;
  projected_payoff_months: number | null;
  projected_total_interest: number | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface DebtStatement {
  id: string;
  debt_id: string;
  file_url: string;
  parsed_balance: number | null;
  parsed_minimum: number | null;
  parsed_due_date: string | null;
  statement_date: string;
  confirmed: boolean;
  created_at: string;
}

export interface ProjectedIncome {
  id: string;
  book: Book;
  date: string;
  amount: number;
  source: string;
  confidence: ConfidenceLevel;
  created_at: string;
}

export interface BridgeLink {
  id: string;
  business_transaction_id: string;
  personal_transaction_id: string;
  amount: number;
  matched_at: string;
}

export interface PlanOverride {
  id: string;
  user_id: string;
  bill_id: string | null;
  subscription_id: string | null;
  debt_id: string | null;
  override_tier: PriorityTier;
  created_at: string;
}

export interface PlaidItem {
  id: string;
  user_id: string;
  plaid_item_id: string;
  plaid_access_token: string;
  institution_name: string | null;
  cursor: string | null;
  created_at: string;
}

export type BudgetPeriodType =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom";

export type BudgetPeriodStatus = "active" | "closed";

export interface Budget {
  id: string;
  user_id: string;
  book: Book;
  name: string;
  period: BudgetPeriodType;
  period_start_date: string | null;
  period_end_date: string | null;
  recurrence_rule: string | null;
  total_amount: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BudgetCategory {
  id: string;
  budget_id: string;
  category_id: string;
  allocated_amount: number;
  rollover: boolean;
  notes: string | null;
}

export interface BudgetPeriodRecord {
  id: string;
  budget_id: string;
  period_start: string;
  period_end: string;
  total_allocated: number;
  total_spent: number;
  status: BudgetPeriodStatus;
  closed_at: string | null;
}

export interface BudgetAdjustment {
  id: string;
  budget_category_id: string;
  old_amount: number;
  new_amount: number;
  reason: string | null;
  adjusted_by: string | null;
}

export interface BudgetWithCategories extends Budget {
  budget_categories: BudgetCategory[];
}
