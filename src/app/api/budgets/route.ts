import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeSpent, currentPeriodRange } from "@/lib/budgets/compute";
import type { Transaction } from "@/lib/types";

const VALID_PERIODS = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
  "custom",
] as const;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const book = request.nextUrl.searchParams.get("book");

  let query = supabase
    .from("budgets")
    .select("*, budget_categories(*)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (book) query = query.eq("book", book);

  const { data: budgets, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  // Compute current period spent per budget using its own book's transactions
  const booksNeeded = Array.from(
    new Set((budgets || []).map((b: { book: string }) => b.book))
  );

  const txByBook = new Map<string, Transaction[]>();
  if (booksNeeded.length > 0) {
    const { data: allTx } = await supabase
      .from("transactions")
      .select("*")
      .in("book", booksNeeded);
    for (const tx of allTx || []) {
      const list = txByBook.get(tx.book) || [];
      list.push(tx as Transaction);
      txByBook.set(tx.book, list);
    }
  }

  const enriched = (budgets || []).map(
    (b: {
      book: string;
      budget_categories?: { allocated_amount: number }[];
      period: string;
      period_start_date: string | null;
      period_end_date: string | null;
    }) => {
      const tx = txByBook.get(b.book) || [];
      const spentMap = computeSpent(
        b as {
          period: (typeof VALID_PERIODS)[number];
          period_start_date: string | null;
          period_end_date: string | null;
          book: "personal" | "business" | "nonprofit";
        },
        tx
      );
      let totalSpent = 0;
      for (const v of spentMap.values()) totalSpent += v;
      const totalAllocated = (b.budget_categories || []).reduce(
        (s: number, c: { allocated_amount: number }) =>
          s + Number(c.allocated_amount || 0),
        0
      );
      const range = currentPeriodRange(
        b as {
          period: (typeof VALID_PERIODS)[number];
          period_start_date: string | null;
          period_end_date: string | null;
        }
      );
      return {
        ...b,
        current_period_spent: totalSpent,
        current_period_allocated: totalAllocated,
        current_period_start: range.start.toISOString().split("T")[0],
        current_period_end: range.end.toISOString().split("T")[0],
        spent_by_category: Object.fromEntries(spentMap),
      };
    }
  );

  return NextResponse.json({ budgets: enriched });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  if (!body.name || !body.period) {
    return NextResponse.json(
      { error: "name and period are required" },
      { status: 400 }
    );
  }

  if (!VALID_PERIODS.includes(body.period)) {
    return NextResponse.json(
      {
        error: `period must be one of: ${VALID_PERIODS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().split("T")[0];

  const insert = {
    user_id: user.id,
    book: body.book || "personal",
    name: body.name,
    period: body.period,
    period_start_date: body.period_start_date || today,
    period_end_date: body.period_end_date || null,
    recurrence_rule: body.recurrence_rule || null,
    total_amount: body.total_amount ?? null,
    is_active: true,
  };

  const { data: budget, error } = await supabase
    .from("budgets")
    .insert(insert)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  // Create budget_categories in batch
  const categories = Array.isArray(body.categories) ? body.categories : [];
  let budgetCategories: unknown[] = [];
  if (categories.length > 0) {
    const rows = categories
      .filter((c: { category_id?: string }) => c.category_id)
      .map(
        (c: {
          category_id: string;
          allocated_amount?: number;
          rollover?: boolean;
          notes?: string;
        }) => ({
          budget_id: budget.id,
          category_id: c.category_id,
          allocated_amount: c.allocated_amount ?? 0,
          rollover: c.rollover === true,
          notes: c.notes || null,
        })
      );
    if (rows.length > 0) {
      const { data: bcs, error: bcError } = await supabase
        .from("budget_categories")
        .insert(rows)
        .select();
      if (bcError) {
        // Rollback the budget
        await supabase.from("budgets").delete().eq("id", budget.id);
        return NextResponse.json(
          { error: bcError.message },
          { status: 400 }
        );
      }
      budgetCategories = bcs || [];
    }
  }

  return NextResponse.json({
    budget: { ...budget, budget_categories: budgetCategories },
  });
}
