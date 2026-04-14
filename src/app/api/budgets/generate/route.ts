import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { generateBudget } from "@/lib/budgets/generate";
import type { Book, BudgetPeriodType } from "@/lib/types";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"];
const PERIODS: readonly BudgetPeriodType[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
];

interface Body {
  book: Book;
  lookback_months?: number;
  period?: BudgetPeriodType;
  round_to?: number;
  drop_noise?: boolean;
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
  if (!BOOKS.includes(body.book))
    return NextResponse.json({ error: "Invalid book" }, { status: 400 });

  const lookback = [1, 3, 6, 12].includes(body.lookback_months ?? 3)
    ? (body.lookback_months as number)
    : 3;
  const period = PERIODS.includes(body.period ?? "monthly")
    ? (body.period as BudgetPeriodType)
    : "monthly";
  const round_to = [10, 25, 50].includes(body.round_to ?? 25)
    ? (body.round_to as number)
    : 25;

  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(body.book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await generateBudget(admin, {
    book: body.book,
    lookback_months: lookback,
    period,
    round_to,
    drop_noise: body.drop_noise ?? true,
  });

  return NextResponse.json(result);
}
