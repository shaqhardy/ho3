import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  INCOME_CATEGORIES,
  INCOME_CLASSIFICATIONS,
  type IncomeCategory,
  type IncomeClassification,
  type Book,
} from "@/lib/types";

interface Body {
  category?: IncomeCategory;
  source?: string | null;
  classification?: IncomeClassification;
}

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

  let body: Body = {};
  try {
    body = (await request.json().catch(() => ({}))) as Body;
  } catch {
    /* empty body is fine — confirm-only */
  }

  const admin = await createServiceClient();
  const { data: entry } = await admin
    .from("income_entries")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();
  if (!entry)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(entry.book as Book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updates: Record<string, unknown> = { is_confirmed: true };
  if (body.category) {
    if (!INCOME_CATEGORIES.includes(body.category))
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    updates.category = body.category;
  }
  if ("source" in body)
    updates.source = body.source ? body.source.trim() : null;
  if (body.classification) {
    if (!INCOME_CLASSIFICATIONS.includes(body.classification))
      return NextResponse.json(
        { error: "invalid classification" },
        { status: 400 }
      );
    updates.classification = body.classification;
  }

  const { data, error } = await admin
    .from("income_entries")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ entry: data });
}
