import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeSpent, currentPeriodRange } from "@/lib/budgets/compute";
import type { Transaction } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: budget, error } = await supabase
    .from("budgets")
    .select("*, budget_categories(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 404 });

  const range = currentPeriodRange(budget);
  const startStr = range.start.toISOString().split("T")[0];
  const endStr = range.end.toISOString().split("T")[0];

  const [{ data: transactions }, { data: periods }] = await Promise.all([
    supabase
      .from("transactions")
      .select("*")
      .eq("book", budget.book)
      .gte("date", startStr)
      .lte("date", endStr),
    supabase
      .from("budget_periods")
      .select("*")
      .eq("budget_id", id)
      .order("period_end", { ascending: false }),
  ]);

  const spentMap = computeSpent(
    budget,
    (transactions || []) as Transaction[]
  );
  let totalSpent = 0;
  for (const v of spentMap.values()) totalSpent += v;

  const totalAllocated = (budget.budget_categories || []).reduce(
    (s: number, c: { allocated_amount: number }) =>
      s + Number(c.allocated_amount || 0),
    0
  );

  return NextResponse.json({
    budget: {
      ...budget,
      current_period_spent: totalSpent,
      current_period_allocated: totalAllocated,
      current_period_start: startStr,
      current_period_end: endStr,
      spent_by_category: Object.fromEntries(spentMap),
    },
    transactions: transactions || [],
    periods: periods || [],
  });
}

export async function PATCH(
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

  const body = await request.json();
  const allowed = [
    "name",
    "period",
    "period_start_date",
    "period_end_date",
    "recurrence_rule",
    "total_amount",
    "is_active",
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) updates[k] = body[k];

  const { data, error } = await supabase
    .from("budgets")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, budget_categories(*)")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ budget: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("budgets")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}
