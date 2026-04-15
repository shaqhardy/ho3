import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  source_id: string;
  target_id: string;
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
  if (!body.source_id || !body.target_id || body.source_id === body.target_id)
    return NextResponse.json(
      { error: "source_id and target_id required and must differ" },
      { status: 400 }
    );

  const admin = await createServiceClient();
  const { data: rows } = await admin
    .from("categories")
    .select("id, book")
    .in("id", [body.source_id, body.target_id]);
  const cats = (rows ?? []) as { id: string; book: Book }[];
  const source = cats.find((c) => c.id === body.source_id);
  const target = cats.find((c) => c.id === body.target_id);
  if (!source || !target)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (source.book !== target.book)
    return NextResponse.json(
      { error: "Categories must belong to the same book" },
      { status: 400 }
    );

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(source.book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Migrate references from source -> target across every table that has a
  // category_id FK.
  await admin
    .from("transactions")
    .update({ category_id: body.target_id })
    .eq("category_id", body.source_id);
  await admin
    .from("bills")
    .update({ category_id: body.target_id })
    .eq("category_id", body.source_id);
  await admin
    .from("subscriptions")
    .update({ category_id: body.target_id })
    .eq("category_id", body.source_id);
  await admin
    .from("budget_categories")
    .update({ category_id: body.target_id })
    .eq("category_id", body.source_id);
  await admin
    .from("category_rules")
    .update({ category_id: body.target_id })
    .eq("category_id", body.source_id);

  // Orphaned children: re-parent to target.
  await admin
    .from("categories")
    .update({ parent_id: body.target_id })
    .eq("parent_id", body.source_id);

  const { error } = await admin
    .from("categories")
    .delete()
    .eq("id", body.source_id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}
