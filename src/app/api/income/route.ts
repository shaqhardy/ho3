import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { INCOME_CATEGORIES, type IncomeCategory, type Book } from "@/lib/types";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

interface CreateBody {
  book: Book;
  amount: number;
  received_date?: string | null;
  expected_date?: string | null;
  source?: string | null;
  category?: IncomeCategory;
  notes?: string | null;
  account_id?: string | null;
  linked_plan_item_id?: string | null;
}

async function gate(userId: string, book: Book) {
  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { ok: false as const, admin };
  if (profile.role === "admin") return { ok: true as const, admin };
  const allowed = (profile.allowed_books ?? []) as Book[];
  return { ok: allowed.includes(book), admin };
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
  const accountId = sp.get("account_id");
  const source = sp.get("source");
  const category = sp.get("category");
  const from = sp.get("from");
  const to = sp.get("to");
  const isConfirmed = sp.get("is_confirmed");
  const limit = Math.min(Number(sp.get("limit") || 500), 5000);

  let q = supabase
    .from("income_entries")
    .select("*")
    .order("received_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (book && BOOKS.includes(book)) q = q.eq("book", book);
  if (accountId) q = q.eq("account_id", accountId);
  if (source) q = q.ilike("source", `%${source}%`);
  if (category && INCOME_CATEGORIES.includes(category as IncomeCategory))
    q = q.eq("category", category);
  if (from) q = q.gte("received_date", from);
  if (to) q = q.lte("received_date", to);
  if (isConfirmed === "true") q = q.eq("is_confirmed", true);
  if (isConfirmed === "false") q = q.eq("is_confirmed", false);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.book || !BOOKS.includes(body.book))
    return NextResponse.json({ error: "book required" }, { status: 400 });
  if (!body.amount || body.amount <= 0)
    return NextResponse.json(
      { error: "amount must be positive" },
      { status: 400 }
    );
  if (!body.received_date && !body.expected_date)
    return NextResponse.json(
      { error: "received_date or expected_date required" },
      { status: 400 }
    );
  if (
    body.category &&
    !INCOME_CATEGORIES.includes(body.category as IncomeCategory)
  )
    return NextResponse.json({ error: "invalid category" }, { status: 400 });

  const g = await gate(user.id, body.book);
  if (!g.ok)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await g.admin
    .from("income_entries")
    .insert({
      user_id: user.id,
      book: body.book,
      account_id: body.account_id ?? null,
      amount: body.amount,
      received_date: body.received_date ?? null,
      expected_date: body.expected_date ?? null,
      source: body.source?.trim() || null,
      category: body.category ?? "other",
      notes: body.notes?.trim() || null,
      linked_plan_item_id: body.linked_plan_item_id ?? null,
      is_confirmed: true,
    })
    .select("*")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ entry: data });
}
