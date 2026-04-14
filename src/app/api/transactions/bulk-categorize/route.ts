import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Book = "personal" | "business" | "nonprofit";

interface Body {
  ids: string[];
  category_id: string | null;
  create_rules?: boolean;
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
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (body.ids.length > 500) {
    return NextResponse.json({ error: "Too many ids (max 500)" }, { status: 400 });
  }

  const admin = await createServiceClient();

  // Book-access check: pull all involved txns, verify each book is allowed.
  const { data: rows } = await admin
    .from("transactions")
    .select("id, book, merchant")
    .in("id", body.ids);
  if (!rows || rows.length === 0)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  const allowed = (profile?.allowed_books ?? []) as Book[];
  for (const r of rows) {
    if (!isAdmin && !allowed.includes(r.book as Book))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await admin
    .from("transactions")
    .update({ category_id: body.category_id })
    .in("id", body.ids);

  let rulesCreated = 0;
  let retroactive_updated = 0;
  if (body.create_rules && body.category_id) {
    // Group by (book, merchant) so we write one rule per distinct merchant in
    // the selection, not one rule per transaction.
    const pairs = new Map<string, { book: Book; merchant: string }>();
    for (const r of rows as { book: string; merchant: string | null }[]) {
      if (!r.merchant) continue;
      pairs.set(`${r.book}::${r.merchant}`, {
        book: r.book as Book,
        merchant: r.merchant,
      });
    }
    for (const { book, merchant } of pairs.values()) {
      const { data: existing } = await admin
        .from("category_rules")
        .select("id")
        .eq("book", book)
        .eq("merchant_pattern", merchant)
        .maybeSingle();
      if (existing) {
        await admin
          .from("category_rules")
          .update({ category_id: body.category_id })
          .eq("id", existing.id);
      } else {
        await admin.from("category_rules").insert({
          book,
          merchant_pattern: merchant,
          category_id: body.category_id,
        });
        rulesCreated++;
      }

      // Retroactive: sweep any still-uncategorized transactions for this
      // merchant+book that weren't in the explicit selection.
      const { count: swept } = await admin
        .from("transactions")
        .update({ category_id: body.category_id }, { count: "exact" })
        .eq("book", book)
        .eq("merchant", merchant)
        .is("category_id", null);
      retroactive_updated += swept ?? 0;
    }
  }

  return NextResponse.json({
    success: true,
    updated: rows.length,
    rules_created: rulesCreated,
    retroactive_updated,
  });
}
