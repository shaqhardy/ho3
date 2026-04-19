import { notFound, redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { AccountDetailView } from "@/components/accounts/account-detail-view";
import type {
  DebtRecord,
  SnapshotRecord,
  StatementRecord,
  TransactionRecord,
} from "@/components/accounts/account-detail-types";
import type { Book, IncomeEntry } from "@/lib/types";
import { fetchAllPaginated } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AccountDetailPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/login");

  // Pull the row through RLS so access check is automatic (user_has_book_access).
  const { data: account } = await supabase
    .from("accounts")
    .select(
      "id, book, name, nickname, type, subtype, mask, current_balance, available_balance, last_synced_at, plaid_item_id, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!account) {
    // Could be RLS-blocked or truly missing — either way, 404 to the user.
    notFound();
  }

  // Service client for joined reads (transactions with categories, statements,
  // snapshots, debt). We've already authorized via RLS check above.
  const admin = await createServiceClient();

  const since12mo = new Date();
  since12mo.setMonth(since12mo.getMonth() - 12);
  const since12moYmd = since12mo.toISOString().slice(0, 10);

  const since24mo = new Date();
  since24mo.setMonth(since24mo.getMonth() - 24);
  const since24moYmd = since24mo.toISOString().slice(0, 10);

  const since365d = new Date();
  since365d.setDate(since365d.getDate() - 365);
  const since365dYmd = since365d.toISOString().slice(0, 10);

  const incomeSince = new Date();
  incomeSince.setMonth(incomeSince.getMonth() - 11);
  incomeSince.setDate(1);
  const incomeSinceYmd = incomeSince.toISOString().slice(0, 10);

  const [
    { data: institution },
    { data: transactions },
    { data: debt },
    { data: statements },
    { data: snapshots },
    incomeEntries,
    unconfirmedIncome,
  ] = await Promise.all([
    account.plaid_item_id
      ? admin
          .from("plaid_items")
          .select("institution_name")
          .eq("plaid_item_id", account.plaid_item_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("transactions")
      .select(
        "id, account_id, book, date, amount, merchant, description, category_id, notes, is_income, ai_categorized, pfc_primary, pfc_detailed, split_parent_id, created_at, categories(id, name, color)"
      )
      .eq("account_id", id)
      .gte("date", since12moYmd)
      .order("date", { ascending: false })
      .limit(5000),
    admin.from("debts").select("*").eq("account_id", id).maybeSingle(),
    admin
      .from("account_statements")
      .select("*")
      .eq("account_id", id)
      .gte("period_end", since24moYmd)
      .order("period_end", { ascending: false })
      .limit(50),
    admin
      .from("account_balance_snapshots")
      .select("id, account_id, snapshot_date, current_balance, available_balance")
      .eq("account_id", id)
      .gte("snapshot_date", since365dYmd)
      .order("snapshot_date", { ascending: true })
      .limit(500),
    fetchAllPaginated<IncomeEntry>((from, to) =>
      admin
        .from("income_entries")
        .select("*")
        .eq("account_id", id)
        .eq("is_confirmed", true)
        .gte("received_date", incomeSinceYmd)
        .order("received_date", { ascending: false })
        .range(from, to)
    ),
    fetchAllPaginated<IncomeEntry>((from, to) =>
      admin
        .from("income_entries")
        .select("*")
        .eq("account_id", id)
        .eq("is_confirmed", false)
        .order("received_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
  ]);

  return (
    <AccountDetailView
      account={{
        id: account.id,
        book: account.book as Book,
        name: account.name,
        nickname: account.nickname,
        type: account.type,
        subtype: account.subtype,
        mask: account.mask,
        current_balance: Number(account.current_balance ?? 0),
        available_balance:
          account.available_balance === null
            ? null
            : Number(account.available_balance),
        last_synced_at: account.last_synced_at,
        institution_name: institution?.institution_name ?? null,
      }}
      transactions={(transactions ?? []) as unknown as TransactionRecord[]}
      debt={(debt as DebtRecord | null) ?? null}
      statements={(statements ?? []) as StatementRecord[]}
      snapshots={(snapshots ?? []) as SnapshotRecord[]}
      incomeEntries={incomeEntries}
      unconfirmedIncome={unconfirmedIncome}
    />
  );
}
