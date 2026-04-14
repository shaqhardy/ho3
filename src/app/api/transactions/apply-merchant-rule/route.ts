import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Book = "personal" | "business" | "nonprofit";

interface Body {
  book: Book;
  merchant: string;
  category_id: string | null;
  /** "uncategorized" (default) only updates rows where category_id is null;
   *  "all" overwrites every matching row. */
  scope?: "uncategorized" | "all";
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
  if (!body.book || !body.merchant)
    return NextResponse.json(
      { error: "book and merchant required" },
      { status: 400 }
    );

  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(body.book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Upsert the rule (so the next Plaid import also auto-tags).
  let rule_created = false;
  if (body.category_id) {
    const { data: existing } = await admin
      .from("category_rules")
      .select("id")
      .eq("book", body.book)
      .eq("merchant_pattern", body.merchant)
      .maybeSingle();
    if (existing) {
      await admin
        .from("category_rules")
        .update({ category_id: body.category_id })
        .eq("id", existing.id);
    } else {
      await admin.from("category_rules").insert({
        book: body.book,
        merchant_pattern: body.merchant,
        category_id: body.category_id,
      });
      rule_created = true;
    }
  }

  // Retroactive sweep.
  const scope = body.scope ?? "uncategorized";
  let query = admin
    .from("transactions")
    .update({ category_id: body.category_id }, { count: "exact" })
    .eq("book", body.book)
    .eq("merchant", body.merchant);
  if (scope === "uncategorized") {
    query = query.is("category_id", null);
  }
  const { count } = await query;

  return NextResponse.json({
    success: true,
    updated: count ?? 0,
    rule_created,
  });
}
