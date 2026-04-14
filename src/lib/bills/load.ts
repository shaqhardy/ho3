import { createClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

export interface BillRow {
  id: string;
  book: Book;
  user_id: string | null;
  name: string;
  biller: string | null;
  amount: number | string | null;
  variable: boolean;
  typical_amount: number | string | null;
  account_id: string | null;
  category_id: string | null;
  due_date: string;
  due_day: number | null;
  is_recurring: boolean;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly" | null;
  autopay: boolean;
  priority_tier: "1" | "2" | "3";
  status: "upcoming" | "paid" | "overdue" | "skipped";
  lifecycle: "active" | "paused" | "cancelled";
  notes: string | null;
  last_paid_date: string | null;
  last_paid_amount: number | string | null;
  created_at: string;
  updated_at: string;
}

export interface AcctLite {
  id: string;
  name: string;
  mask: string | null;
  book: Book;
}

export interface CategoryLite {
  id: string;
  name: string;
  book: Book;
}

export interface BillPaymentRow {
  id: string;
  bill_id: string;
  date_paid: string;
  amount_paid: number | string;
  account_id: string | null;
  transaction_id: string | null;
  manual: boolean;
  note: string | null;
  created_at: string;
}

export type BillsLoadResult =
  | {
      bills: BillRow[];
      payments: BillPaymentRow[];
      accounts: AcctLite[];
      categories: CategoryLite[];
    }
  | "unauthorized"
  | "forbidden";

export async function loadBillsData(book: Book): Promise<BillsLoadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "unauthorized";
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return "unauthorized";
  if (
    profile.role !== "admin" &&
    !(profile.allowed_books ?? []).includes(book)
  )
    return "forbidden";

  const [{ data: bills }, { data: accounts }, { data: categories }] =
    await Promise.all([
      supabase
        .from("bills")
        .select("*")
        .eq("book", book)
        .order("due_date"),
      supabase
        .from("accounts")
        .select("id, name, mask, book")
        .eq("book", book)
        .eq("is_hidden", false)
        .order("name"),
      supabase
        .from("categories")
        .select("id, name, book")
        .eq("book", book)
        .order("name"),
    ]);

  const billIds = (bills ?? []).map((b) => b.id);
  const { data: payments } =
    billIds.length === 0
      ? { data: [] as BillPaymentRow[] }
      : await supabase
          .from("bill_payments")
          .select("*")
          .in("bill_id", billIds)
          .order("date_paid", { ascending: false });

  return {
    bills: (bills ?? []) as BillRow[],
    payments: (payments ?? []) as BillPaymentRow[],
    accounts: (accounts ?? []) as AcctLite[],
    categories: (categories ?? []) as CategoryLite[],
  };
}
