import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Book = "personal" | "business" | "nonprofit";

interface Body {
  category_id?: string | null;
  notes?: string | null;
  merchant?: string;
  /**
   * When true, the server creates a category_rule keyed to the transaction's
   * merchant so future imports with the same merchant inherit the new category.
   * The transactions view sends this when the user actively changes the category.
   */
  create_rule?: boolean;
}

async function ensureAccess(userId: string, book: Book) {
  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { ok: false, admin } as const;
  if (profile.role === "admin") return { ok: true, admin } as const;
  const allowed = (profile.allowed_books ?? []) as Book[];
  return { ok: allowed.includes(book), admin } as const;
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

  const admin = await createServiceClient();
  const { data: existing } = await admin
    .from("transactions")
    .select("id, book, merchant, category_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await ensureAccess(user.id, existing.book as Book);
  if (!gate.ok)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if ("category_id" in body) updates.category_id = body.category_id;
  if ("notes" in body) updates.notes = body.notes;
  if ("merchant" in body && typeof body.merchant === "string")
    updates.merchant = body.merchant;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: true, noop: true });
  }

  const { error } = await admin
    .from("transactions")
    .update(updates)
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  // Auto-rule: remember this merchant→category mapping so future imports with
  // the same merchant inherit the user's choice. Also retroactively apply the
  // new category to existing uncategorized transactions from the same
  // merchant — only uncategorized ones, so we never clobber a manual choice.
  let retroactive_updated = 0;
  if (
    body.create_rule &&
    "category_id" in body &&
    body.category_id &&
    existing.merchant
  ) {
    const { data: existingRule } = await admin
      .from("category_rules")
      .select("id")
      .eq("book", existing.book)
      .eq("merchant_pattern", existing.merchant)
      .maybeSingle();
    if (existingRule) {
      await admin
        .from("category_rules")
        .update({ category_id: body.category_id })
        .eq("id", existingRule.id);
    } else {
      await admin.from("category_rules").insert({
        book: existing.book,
        merchant_pattern: existing.merchant,
        category_id: body.category_id,
      });
    }

    const { count } = await admin
      .from("transactions")
      .update({ category_id: body.category_id }, { count: "exact" })
      .eq("book", existing.book)
      .eq("merchant", existing.merchant)
      .is("category_id", null)
      .neq("id", id);
    retroactive_updated = count ?? 0;
  }

  return NextResponse.json({ success: true, retroactive_updated });
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
  const { data: existing } = await admin
    .from("transactions")
    .select("id, book, plaid_transaction_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await ensureAccess(user.id, existing.book as Book);
  if (!gate.ok)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Deleting a Plaid-sourced txn is pointless — it'll come back on next sync.
  // Allow delete only for manually-entered (no plaid_transaction_id) or split children.
  if (existing.plaid_transaction_id) {
    return NextResponse.json(
      {
        error:
          "Plaid-sourced transactions cannot be deleted (they'd sync back). Edit notes or category instead.",
      },
      { status: 409 }
    );
  }

  await admin.from("transactions").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
