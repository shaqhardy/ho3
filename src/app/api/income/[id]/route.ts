import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  INCOME_CATEGORIES,
  INCOME_CLASSIFICATIONS,
  type IncomeCategory,
  type IncomeClassification,
  type Book,
} from "@/lib/types";

interface PatchBody {
  amount?: number;
  received_date?: string | null;
  expected_date?: string | null;
  source?: string | null;
  category?: IncomeCategory;
  classification?: IncomeClassification;
  notes?: string | null;
  account_id?: string | null;
  linked_plan_item_id?: string | null;
  is_confirmed?: boolean;
}

async function loadAndGate(userId: string, id: string) {
  const admin = await createServiceClient();
  const { data: entry } = await admin
    .from("income_entries")
    .select("id, book, user_id, linked_transaction_id")
    .eq("id", id)
    .maybeSingle();
  if (!entry) return { ok: false as const, status: 404, admin, entry: null };
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", userId)
    .maybeSingle();
  if (!profile)
    return { ok: false as const, status: 401, admin, entry };
  const allowed = (profile.allowed_books ?? []) as Book[];
  const ok = profile.role === "admin" || allowed.includes(entry.book as Book);
  return {
    ok: ok as true | false,
    status: ok ? 200 : 403,
    admin,
    entry,
  } as const;
}

export async function PATCH(
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

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const g = await loadAndGate(user.id, id);
  if (!g.ok)
    return NextResponse.json(
      { error: g.status === 404 ? "Not found" : "Forbidden" },
      { status: g.status }
    );

  const updates: Record<string, unknown> = {};
  if ("amount" in body && typeof body.amount === "number") {
    if (body.amount <= 0)
      return NextResponse.json(
        { error: "amount must be positive" },
        { status: 400 }
      );
    updates.amount = body.amount;
  }
  if ("received_date" in body) updates.received_date = body.received_date;
  if ("expected_date" in body) updates.expected_date = body.expected_date;
  if ("source" in body)
    updates.source = body.source ? body.source.trim() : null;
  if ("category" in body && body.category) {
    if (!INCOME_CATEGORIES.includes(body.category))
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    updates.category = body.category;
  }
  if ("classification" in body && body.classification) {
    if (!INCOME_CLASSIFICATIONS.includes(body.classification))
      return NextResponse.json(
        { error: "invalid classification" },
        { status: 400 }
      );
    updates.classification = body.classification;
  }
  if ("notes" in body) updates.notes = body.notes ? body.notes.trim() : null;
  if ("account_id" in body) updates.account_id = body.account_id;
  if ("linked_plan_item_id" in body)
    updates.linked_plan_item_id = body.linked_plan_item_id;
  if ("is_confirmed" in body && typeof body.is_confirmed === "boolean")
    updates.is_confirmed = body.is_confirmed;

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ success: true, noop: true });

  const { data, error } = await g.admin
    .from("income_entries")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ entry: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const g = await loadAndGate(user.id, id);
  if (!g.ok)
    return NextResponse.json(
      { error: g.status === 404 ? "Not found" : "Forbidden" },
      { status: g.status }
    );

  const { error } = await g.admin
    .from("income_entries")
    .delete()
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}
