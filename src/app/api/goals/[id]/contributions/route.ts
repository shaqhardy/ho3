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

  // Verify the goal belongs to user
  const { data: goal } = await supabase
    .from("goals")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!goal)
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });

  const body = await request.json();
  if (body.amount == null) {
    return NextResponse.json({ error: "amount required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("goal_contributions")
    .insert({
      goal_id: id,
      amount: body.amount,
      date: body.date || new Date().toISOString().split("T")[0],
      source: "manual",
      note: body.note || null,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ contribution: data });
}
