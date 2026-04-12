import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; categoryRowId: string }> }
) {
  const { id, categoryRowId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Confirm parent budget belongs to this user
  const { data: budget } = await supabase
    .from("budgets")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!budget)
    return NextResponse.json({ error: "Budget not found" }, { status: 404 });

  // Fetch current row (for adjustment logging)
  const { data: existing, error: exErr } = await supabase
    .from("budget_categories")
    .select("*")
    .eq("id", categoryRowId)
    .eq("budget_id", id)
    .single();
  if (exErr || !existing)
    return NextResponse.json(
      { error: "Budget category not found" },
      { status: 404 }
    );

  const body = await request.json();
  const allowed = ["allocated_amount", "rollover", "notes", "category_id"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) updates[k] = body[k];

  const { data, error } = await supabase
    .from("budget_categories")
    .update(updates)
    .eq("id", categoryRowId)
    .eq("budget_id", id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  // Log an adjustment if the allocation changed
  if (
    "allocated_amount" in updates &&
    Number(existing.allocated_amount) !== Number(data.allocated_amount)
  ) {
    await supabase.from("budget_adjustments").insert({
      budget_category_id: categoryRowId,
      old_amount: existing.allocated_amount,
      new_amount: data.allocated_amount,
      reason: body.reason || null,
      adjusted_by: user.id,
    });
  }

  return NextResponse.json({ budget_category: data });
}

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; categoryRowId: string }> }
) {
  const { id, categoryRowId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Confirm parent budget belongs to this user
  const { data: budget } = await supabase
    .from("budgets")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!budget)
    return NextResponse.json({ error: "Budget not found" }, { status: 404 });

  const { error } = await supabase
    .from("budget_categories")
    .delete()
    .eq("id", categoryRowId)
    .eq("budget_id", id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}
