import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { fetchAllPaginated } from "@/lib/supabase/paginate";
import { IncomeView } from "@/components/income/income-view";
import type { Book, IncomeEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

interface AcctRow {
  id: string;
  name: string;
  mask: string | null;
  book: Book;
}

export default async function IncomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/login");

  const allowed: Book[] =
    profile.role === "admin"
      ? ["personal", "business", "nonprofit"]
      : ((profile.allowed_books ?? []) as Book[]);

  if (allowed.length === 0) redirect("/personal");

  const admin = await createServiceClient();

  const [accountsRes, entries] = await Promise.all([
    admin
      .from("accounts")
      .select("id, name, mask, book")
      .in("book", allowed)
      .order("name"),
    fetchAllPaginated<IncomeEntry>((from, to) =>
      admin
        .from("income_entries")
        .select("*")
        .in("book", allowed)
        .order("received_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
  ]);

  const accounts = (accountsRes.data ?? []) as AcctRow[];

  return (
    <IncomeView
      entries={entries}
      accounts={accounts}
      availableBooks={allowed}
    />
  );
}
