import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { fetchAllPaginated } from "@/lib/supabase/paginate";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

/**
 * GET /api/admin/txn-count?book=personal
 *
 * Verification endpoint for the 1000-row cap fix. Returns:
 *   raw_count_all_time: SELECT COUNT(*) FROM transactions WHERE book = $1
 *   raw_count_since_13mo: same but restricted to the overview trend window
 *   via_monthly_flows_count: sum of income_count + expense_count over the
 *     same 13-month window (exercises the monthly_flows RPC)
 *   via_paginated_count: length of fetchAllPaginated result over the same
 *     window (exercises the paginated helper)
 *   delta_rpc / delta_paginated: should both be 0 if the fix is working
 *
 * If raw ≠ via_* the dashboard is still losing rows. Hit this in prod after
 * deploy for each book and eyeball-compare to the Supabase SQL editor.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const book = request.nextUrl.searchParams.get("book") as Book | null;
  if (!book || !BOOKS.includes(book))
    return NextResponse.json(
      { error: "book query param required (personal|business|nonprofit)" },
      { status: 400 }
    );

  const trendsSince = new Date();
  trendsSince.setMonth(trendsSince.getMonth() - 13);
  const trendsSinceYmd = trendsSince.toISOString().slice(0, 10);

  // Note on split parents: the RPCs exclude split parents (children carry
  // the real data). The raw counts below include them. For an apples-to-
  // apples compare we compute a raw count that also excludes parents with
  // children — this matches what the dashboard actually summarizes.
  const [
    { count: rawAll },
    { count: rawWindow },
    { count: splitParentsWindow },
    flowsRes,
    paginated,
  ] = await Promise.all([
    admin
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .eq("book", book),
    admin
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .eq("book", book)
      .gte("date", trendsSinceYmd),
    admin
      .from("transactions")
      .select("split_parent_id", { count: "exact", head: true })
      .eq("book", book)
      .gte("date", trendsSinceYmd)
      .not("split_parent_id", "is", null),
    admin.rpc("monthly_flows", {
      p_books: [book],
      p_since: trendsSinceYmd,
    }),
    fetchAllPaginated<{ id: string; split_parent_id: string | null }>(
      (from, to) =>
        admin
          .from("transactions")
          .select("id, split_parent_id")
          .eq("book", book)
          .gte("date", trendsSinceYmd)
          .order("date", { ascending: true })
          .range(from, to)
    ),
  ]);

  const flows = (flowsRes.data ?? []) as Array<{
    income_count: number;
    expense_count: number;
  }>;
  const viaRpcCount = flows.reduce(
    (s, r) => s + Number(r.income_count) + Number(r.expense_count),
    0
  );

  // Paginated excludes split parents to match the RPC's accounting.
  const childParents = new Set<string>();
  for (const t of paginated) {
    if (t.split_parent_id) childParents.add(t.split_parent_id);
  }
  const viaPaginatedCount = paginated.filter(
    (t) => !childParents.has(t.id)
  ).length;

  const rawWindowExcludingParents =
    Number(rawWindow ?? 0) - Number(splitParentsWindow ?? 0);

  return NextResponse.json({
    book,
    window_since: trendsSinceYmd,
    raw_count_all_time: Number(rawAll ?? 0),
    raw_count_since_13mo: Number(rawWindow ?? 0),
    raw_count_since_13mo_excl_split_parents: rawWindowExcludingParents,
    via_monthly_flows_count: viaRpcCount,
    via_paginated_count: viaPaginatedCount,
    delta_rpc: rawWindowExcludingParents - viaRpcCount,
    delta_paginated: rawWindowExcludingParents - viaPaginatedCount,
    pass:
      rawWindowExcludingParents === viaRpcCount &&
      rawWindowExcludingParents === viaPaginatedCount,
  });
}
