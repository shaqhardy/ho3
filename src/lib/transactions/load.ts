import { createClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

export interface LoadedTxnData {
  transactions: TxnRow[];
  categories: CatRow[];
  accounts: AcctRow[];
  bills: BillRow[];
}

export interface TxnRow {
  id: string;
  account_id: string | null;
  book: Book;
  date: string;
  amount: number | string;
  merchant: string | null;
  description: string | null;
  category_id: string | null;
  notes: string | null;
  receipt_url: string | null;
  plaid_transaction_id: string | null;
  is_income: boolean;
  split_parent_id: string | null;
  created_at: string;
  categories: { id: string; name: string } | null;
}

export interface CatRow {
  id: string;
  name: string;
  book: Book;
}

export interface AcctRow {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  book: Book;
}

export interface BillRow {
  id: string;
  name: string;
  book: Book;
}

export async function loadTransactionsData(
  book: Book
): Promise<LoadedTxnData | "unauthorized" | "forbidden"> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "unauthorized";

  const { data: profile } = await supabase
    .from("profiles")
    .select("allowed_books, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return "unauthorized";
  if (
    profile.role !== "admin" &&
    !(profile.allowed_books ?? []).includes(book)
  )
    return "forbidden";

  const [{ data: txns }, { data: categories }, { data: accounts }, { data: bills }] =
    await Promise.all([
      supabase
        .from("transactions")
        .select(
          "id, account_id, book, date, amount, merchant, description, category_id, notes, receipt_url, plaid_transaction_id, is_income, split_parent_id, created_at, categories(id, name)"
        )
        .eq("book", book)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("categories")
        .select("id, name, book")
        .eq("book", book)
        .order("name"),
      supabase
        .from("accounts")
        .select("id, name, mask, type, subtype, book")
        .eq("book", book)
        .eq("is_hidden", false)
        .order("name"),
      supabase.from("bills").select("id, name, book").eq("book", book),
    ]);

  return {
    transactions: (txns ?? []) as unknown as TxnRow[],
    categories: (categories ?? []) as CatRow[],
    accounts: (accounts ?? []) as AcctRow[],
    bills: (bills ?? []) as BillRow[],
  };
}
