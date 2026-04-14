import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Book = "personal" | "business" | "nonprofit";
const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

interface Body {
  book: Book;
  name: string;
  biller?: string | null;
  amount?: number | null;
  variable?: boolean;
  typical_amount?: number | null;
  account_id?: string | null;
  category_id?: string | null;
  due_date: string;
  due_day?: number | null;
  is_recurring?: boolean;
  frequency?: "weekly" | "monthly" | "quarterly" | "yearly" | null;
  autopay?: boolean;
  priority_tier?: "1" | "2" | "3";
  notes?: string | null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.book || !BOOKS.includes(body.book))
    return NextResponse.json({ error: "book required" }, { status: 400 });
  if (!body.name)
    return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!body.due_date)
    return NextResponse.json({ error: "due_date required" }, { status: 400 });

  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(body.book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await admin
    .from("bills")
    .insert({
      user_id: user.id,
      book: body.book,
      name: body.name,
      biller: body.biller ?? null,
      amount: body.variable ? null : body.amount ?? null,
      variable: body.variable ?? false,
      typical_amount: body.typical_amount ?? null,
      account_id: body.account_id ?? null,
      category_id: body.category_id ?? null,
      due_date: body.due_date,
      due_day: body.due_day ?? null,
      is_recurring: body.is_recurring ?? true,
      frequency: body.frequency ?? null,
      autopay: body.autopay ?? false,
      priority_tier: body.priority_tier ?? "2",
      notes: body.notes ?? null,
      status: "upcoming",
      lifecycle: "active",
    })
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ bill: data });
}
