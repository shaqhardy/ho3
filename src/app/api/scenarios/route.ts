import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const book = request.nextUrl.searchParams.get("book");
  const savedOnly = request.nextUrl.searchParams.get("saved") === "true";

  let query = supabase
    .from("scenarios")
    .select("*")
    .eq("user_id", user.id)
    .is("promoted_at", null)
    .order("created_at", { ascending: false });

  if (book) query = query.eq("book", book);
  if (savedOnly) query = query.eq("is_saved", true);

  const { data: scenarios, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ scenarios: scenarios || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  if (!body.book || !body.type || !body.name || body.amount == null) {
    return NextResponse.json(
      { error: "book, type, name, amount are required" },
      { status: 400 }
    );
  }

  const insert = {
    user_id: user.id,
    book: body.book,
    type: body.type,
    name: body.name,
    amount: body.amount,
    account_id: body.account_id || null,
    category_id: body.category_id || null,
    source: body.source || null,
    date: body.date || new Date().toISOString().split("T")[0],
    confidence: body.confidence || null,
    override_full_amount: body.override_full_amount === true,
    note: body.note || null,
    is_active: body.is_active !== false,
    is_saved: body.is_saved === true,
  };

  const { data, error } = await supabase
    .from("scenarios")
    .insert(insert)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ scenario: data });
}
