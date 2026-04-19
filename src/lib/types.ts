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
  pfc_primary: string | null;
  pfc_detailed: string | null;
  ai_categorized: boolean;
  ai_categorized_at: string | null;
  ai_confidence: number | null;
  ai_model: string | null;
  created_at: string;
}

export interface AccountStatement {
  id: string;
  account_id: string;
  plaid_statement_id: string | null;
  period_start: string;
  period_end: string;
  opening_balance: number | null;
  closing_balance: number | null;
  total_debits: number | null;
  total_credits: number | null;
  storage_path: string | null;
  byte_size: number | null;
  downloaded_at: string | null;
  created_at: string;
}

export interface AccountBalanceSnapshot {
  id: string;
  account_id: string;
  snapshot_date: string;
  current_balance: number;
  available_balance: number | null;
  created_at: string;
}

export interface Category {
  id: string;
  book: Book;
  name: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  is_shared: boolean;
  is_archived: boolean;
  sort_order: number;
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

export type IncomeClassification =
  | "external_income"
  | "owner_distribution"
  | "internal_transfer";

export const INCOME_CLASSIFICATIONS: readonly IncomeClassification[] = [
  "external_income",
  "owner_distribution",
  "internal_transfer",
] as const;

export const INCOME_CLASSIFICATION_LABELS: Record<IncomeClassification, string> = {
  external_income: "External income",
  owner_distribution: "Owner distribution",
  internal_transfer: "Internal transfer",
};

export interface ProjectedIncome {
  id: string;
  book: Book;
  date: string;
  amount: number;
  source: string;
  confidence: ConfidenceLevel;
  classification: IncomeClassification;
  linked_schedule_id: string | null;
  created_at: string;
}

export type DistributionCadence =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "custom";

export const DISTRIBUTION_CADENCES: readonly DistributionCadence[] = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "custom",
] as const;

export interface DistributionSchedule {
  id: string;
  user_id: string;
  source_book: Book;
  target_book: Book;
  amount: number;
  cadence: DistributionCadence;
  anchor_date: string;
  custom_days: number[] | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type IncomeCategory =
  | "consulting"
  | "speaking"
  | "royalties"
  | "product"
  | "refund"
  | "gift"
  | "other";

export const INCOME_CATEGORIES: readonly IncomeCategory[] = [
  "consulting",
  "speaking",
  "royalties",
  "product",
  "refund",
  "gift",
  "other",
] as const;

export const INCOME_CATEGORY_LABELS: Record<IncomeCategory, string> = {
  consulting: "Consulting",
  speaking: "Speaking",
  royalties: "Royalties",
  product: "Product Sales",
  refund: "Refund",
  gift: "Gift",
  other: "Other",
};

export interface IncomeEntry {
  id: string;
  user_id: string;
  book: Book;
  account_id: string | null;
  amount: number;
  received_date: string | null;
  expected_date: string | null;
  source: string | null;
  category: IncomeCategory;
  notes: string | null;
  linked_transaction_id: string | null;
  linked_plan_item_id: string | null;
  is_confirmed: boolean;
  classification: IncomeClassification;
  likely_transfer: boolean;
  transfer_match_txn_id: string | null;
  created_at: string;
  updated_at: string;
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
