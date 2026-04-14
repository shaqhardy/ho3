import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Book = "personal" | "business" | "nonprofit";

async function gate(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const admin = await createServiceClient();
  const { data: bill } = await admin.from("bills").select("*").eq("id", id).maybeSingle();
  if (!bill) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(bill.book as Book))
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { admin, bill, user } as const;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const g = await gate(id);
  if ("error" in g) return g.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowedFields = [
    "name",
    "biller",
    "amount",
    "variable",
    "typical_amount",
    "account_id",
    "category_id",
    "due_date",
    "due_day",
    "is_recurring",
    "frequency",
    "autopay",
    "priority_tier",
    "notes",
    "status",
    "lifecycle",
    "book",
  ];
  const updates: Record<string, unknown> = {};
  for (const k of allowedFields) if (k in body) updates[k] = body[k];

  const { data, error } = await g.admin
    .from("bills")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ bill: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const g = await gate(id);
  if ("error" in g) return g.error;
  await g.admin.from("bills").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
