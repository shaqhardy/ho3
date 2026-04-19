import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

type Row = {
  received_date: string | null;
  expected_date: string | null;
  book: Book;
  amount: number | string;
  source: string | null;
  category: string;
  notes: string | null;
  account_id: string | null;
  is_confirmed: boolean;
  likely_transfer: boolean;
  linked_transaction_id: string | null;
  linked_plan_item_id: string | null;
  created_at: string;
  accounts?: { name: string | null; mask: string | null } | null;
};

function csvEscape(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const book = sp.get("book") as Book | null;
  const from = sp.get("from");
  const to = sp.get("to");
  const category = sp.get("category");
  const source = sp.get("source");

  let q = supabase
    .from("income_entries")
    .select(
      "received_date, expected_date, book, amount, source, category, notes, account_id, is_confirmed, likely_transfer, linked_transaction_id, linked_plan_item_id, created_at, accounts(name, mask)"
    )
    .order("received_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50000);

  if (book && BOOKS.includes(book)) q = q.eq("book", book);
  if (from) q = q.gte("received_date", from);
  if (to) q = q.lte("received_date", to);
  if (category) q = q.eq("category", category);
  if (source) q = q.ilike("source", `%${source}%`);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []) as unknown as Row[];

  const header = [
    "received_date",
    "expected_date",
    "book",
    "amount",
    "source",
    "category",
    "account",
    "account_mask",
    "notes",
    "is_confirmed",
    "likely_transfer",
    "linked_transaction_id",
    "linked_plan_item_id",
    "created_at",
  ];

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.received_date,
        r.expected_date,
        r.book,
        Number(r.amount),
        r.source,
        r.category,
        r.accounts?.name ?? null,
        r.accounts?.mask ?? null,
        r.notes,
        r.is_confirmed,
        r.likely_transfer,
        r.linked_transaction_id,
        r.linked_plan_item_id,
        r.created_at,
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ho3-income-${today}.csv"`,
    },
  });
}
