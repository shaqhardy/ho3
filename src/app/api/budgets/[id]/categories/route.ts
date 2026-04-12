import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify the budget belongs to this user (RLS will also enforce, but we
  // return a clean 404 if the row doesn't exist for them).
  const { data: budget, error: bErr } = await supabase
    .from("budgets")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (bErr || !budget)
    return NextResponse.json({ error: "Budget not found" }, { status: 404 });

  const body = await request.json();
  if (!body.category_id)
    return NextResponse.json(
      { error: "category_id is required" },
      { status: 400 }
    );

  const insert = {
    budget_id: id,
    category_id: body.category_id,
    allocated_amount: body.allocated_amount ?? 0,
    rollover: body.rollover === true,
    notes: body.notes || null,
  };

  const { data, error } = await supabase
    .from("budget_categories")
    .insert(insert)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ budget_category: data });
}
