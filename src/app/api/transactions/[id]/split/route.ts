import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Book = "personal" | "business" | "nonprofit";

interface Split {
  amount: number;
  category_id: string | null;
  notes?: string | null;
}
interface Body {
  splits: Split[];
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.splits) || body.splits.length < 2) {
    return NextResponse.json(
      { error: "At least two splits required" },
      { status: 400 }
    );
  }

  const admin = await createServiceClient();
  const { data: parent } = await admin
    .from("transactions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!parent)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (parent.split_parent_id) {
    return NextResponse.json(
      { error: "Cannot split a transaction that is already a split child" },
      { status: 400 }
    );
  }

  // Access check
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (!isAdmin && !allowed.includes(parent.book as Book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Validate splits sum to parent amount (to the cent).
  const sum = body.splits.reduce((s, x) => s + Number(x.amount || 0), 0);
  if (Math.abs(sum - Number(parent.amount)) > 0.01) {
    return NextResponse.json(
      {
        error: `Splits must sum to ${parent.amount} (got ${sum.toFixed(2)})`,
      },
      { status: 400 }
    );
  }

  // Remove any prior children before inserting fresh ones.
  await admin.from("transactions").delete().eq("split_parent_id", id);

  const children = body.splits.map((sp, i) => ({
    account_id: parent.account_id,
    book: parent.book,
    date: parent.date,
    amount: Number(sp.amount),
    merchant: parent.merchant,
    description: parent.description ? `${parent.description} (split ${i + 1}/${body.splits.length})` : null,
    category_id: sp.category_id,
    notes: sp.notes ?? null,
    is_income: parent.is_income,
    split_parent_id: id,
  }));
  const { error } = await admin.from("transactions").insert(children);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ success: true, children: children.length });
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

  const admin = await createServiceClient();
  const { data: parent } = await admin
    .from("transactions")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();
  if (!parent)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (!isAdmin && !allowed.includes(parent.book as Book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await admin.from("transactions").delete().eq("split_parent_id", id);
  return NextResponse.json({ success: true });
}
