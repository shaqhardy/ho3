// Row types shared between the account-detail page (server) and the
// account-detail-view (client). Kept in a plain .ts module so Next's route
// metadata extraction doesn't choke on non-page exports.

import type { Book } from "@/lib/types";

export interface TransactionRecord {
  id: string;
  account_id: string | null;
  book: Book;
  date: string;
  amount: number | string;
  merchant: string | null;
  description: string | null;
  category_id: string | null;
  notes: string | null;
  is_income: boolean;
  ai_categorized: boolean;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  split_parent_id: string | null;
  created_at: string;
  categories: { id: string; name: string; color: string | null } | null;
}

export interface DebtRecord {
  id: string;
  account_id: string | null;
  book: Book;
  creditor: string;
  nickname: string | null;
  current_balance: number | string;
  apr: number | string;
  minimum_payment: number | string;
  statement_due_date: string | null;
  original_balance?: number | string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface StatementRecord {
  id: string;
  account_id: string;
  period_start: string;
  period_end: string;
  opening_balance: number | string | null;
  closing_balance: number | string | null;
  total_debits: number | string | null;
  total_credits: number | string | null;
  storage_path: string | null;
  byte_size: number | null;
  downloaded_at: string | null;
  created_at: string;
}

export interface SnapshotRecord {
  id: string;
  account_id: string;
  snapshot_date: string;
  current_balance: number | string;
  available_balance: number | string | null;
}
