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

  // Fetch the scenario
  const { data: scenario, error: fetchError } = await supabase
    .from("scenarios")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  if (scenario.promoted_at) {
    return NextResponse.json(
      { error: "Already promoted" },
      { status: 400 }
    );
  }

  let promotedTo: "bill" | "transaction" | "projected_income";
  let refId: string;

  if (scenario.type === "income") {
    // Create a projected_income entry
    const { data: inserted, error } = await supabase
      .from("projected_income")
      .insert({
        book:
          scenario.book === "cross-book" ? "personal" : scenario.book,
        date: scenario.date,
        amount: scenario.amount,
        source: scenario.source || scenario.name,
        confidence: scenario.confidence || "expected",
      })
      .select()
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });

    promotedTo = "projected_income";
    refId = inserted.id;
  } else {
    // Expense: create a bill (recurring=false, single occurrence)
    const { data: inserted, error } = await supabase
      .from("bills")
      .insert({
        book:
          scenario.book === "cross-book" ? "personal" : scenario.book,
        name: scenario.name,
        amount: scenario.amount,
        due_date: scenario.date,
        account_id: scenario.account_id,
        category_id: scenario.category_id,
        status: "upcoming",
        priority_tier: "3",
        is_recurring: false,
        notes: scenario.note,
      })
      .select()
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });

    promotedTo = "bill";
    refId = inserted.id;
  }

  // Archive the scenario
  await supabase
    .from("scenarios")
    .update({
      promoted_at: new Date().toISOString(),
      promoted_to: promotedTo,
      promoted_ref_id: refId,
      is_active: false,
    })
    .eq("id", id);

  return NextResponse.json({
    success: true,
    promoted_to: promotedTo,
    ref_id: refId,
  });
}
