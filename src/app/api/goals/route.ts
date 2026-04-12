import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeGoalProgress } from "@/lib/goals/compute";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const book = request.nextUrl.searchParams.get("book") || "personal";

  const { data: goals } = await supabase
    .from("goals")
    .select("*")
    .eq("book", book)
    .order("created_at", { ascending: false });

  if (!goals) return NextResponse.json({ goals: [] });

  // Enrich with linked account/debt current values + check for completion
  const accountIds = goals
    .map((g) => g.linked_account_id)
    .filter(Boolean) as string[];
  const debtIds = goals
    .map((g) => g.linked_debt_id)
    .filter(Boolean) as string[];

  const [{ data: accounts }, { data: debts }, { data: contributions }] =
    await Promise.all([
      accountIds.length > 0
        ? supabase
            .from("accounts")
            .select("id, current_balance")
            .in("id", accountIds)
        : Promise.resolve({ data: [] }),
      debtIds.length > 0
        ? supabase
            .from("debts")
            .select("id, current_balance, original_balance")
            .in("id", debtIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("goal_contributions")
        .select("goal_id, amount, date")
        .in(
          "goal_id",
          goals.map((g) => g.id)
        ),
    ]);

  const acctMap = new Map((accounts || []).map((a) => [a.id, a]));
  const debtMap = new Map((debts || []).map((d) => [d.id, d]));

  const enriched = await Promise.all(
    goals.map(async (g) => {
      const linkedAcct = g.linked_account_id
        ? acctMap.get(g.linked_account_id)
        : null;
      const linkedDebt = g.linked_debt_id
        ? debtMap.get(g.linked_debt_id)
        : null;
      const goalContribs =
        contributions?.filter((c) => c.goal_id === g.id) || [];

      const progress = computeGoalProgress(
        g,
        linkedAcct,
        linkedDebt,
        goalContribs
      );

      // Lazy completion: if progress hits target and goal still active, mark completed
      if (progress.isCompleted && g.status === "active") {
        await supabase
          .from("goals")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            current_amount: progress.current,
          })
          .eq("id", g.id);
        g.status = "completed";
        g.completed_at = new Date().toISOString();
      }

      return { ...g, progress };
    })
  );

  return NextResponse.json({ goals: enriched });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (!body.name || !body.type || body.target_amount == null) {
    return NextResponse.json(
      { error: "name, type, target_amount required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("goals")
    .insert({
      user_id: user.id,
      book: body.book || "personal",
      name: body.name,
      type: body.type,
      target_amount: body.target_amount,
      target_date: body.target_date || null,
      linked_account_id: body.linked_account_id || null,
      linked_debt_id: body.linked_debt_id || null,
      note: body.note || null,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ goal: data });
}
