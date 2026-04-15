import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

export const runtime = "nodejs";

interface PatchBody {
  name?: string;
  color?: string | null;
  icon?: string | null;
  parent_id?: string | null;
  is_shared?: boolean;
  is_archived?: boolean;
  sort_order?: number;
}

async function gate(userId: string, book: Book) {
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
    .from("categories")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const access = await gate(user.id, existing.book as Book);
  if (!access.ok)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim())
    updates.name = body.name.trim();
  if ("color" in body) updates.color = body.color ?? null;
  if ("icon" in body) updates.icon = body.icon ?? null;
  if ("parent_id" in body) {
    // Prevent self-parenting.
    if (body.parent_id === id) {
      return NextResponse.json(
        { error: "Cannot set category as its own parent" },
        { status: 400 }
      );
    }
    updates.parent_id = body.parent_id ?? null;
  }
  if (typeof body.is_shared === "boolean") updates.is_shared = body.is_shared;
  if (typeof body.is_archived === "boolean")
    updates.is_archived = body.is_archived;
  if (typeof body.sort_order === "number") updates.sort_order = body.sort_order;

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ success: true, noop: true });

  const { error } = await admin
    .from("categories")
    .update(updates)
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const reassignTo = url.searchParams.get("reassign_to");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await createServiceClient();
  const { data: existing } = await admin
    .from("categories")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const access = await gate(user.id, existing.book as Book);
  if (!access.ok)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Reassign any references (transactions / bills / subscriptions /
  // budget_categories / category_rules) before deletion.
  if (reassignTo) {
    await admin
      .from("transactions")
      .update({ category_id: reassignTo })
      .eq("category_id", id);
    await admin
      .from("bills")
      .update({ category_id: reassignTo })
      .eq("category_id", id);
    await admin
      .from("subscriptions")
      .update({ category_id: reassignTo })
      .eq("category_id", id);
    await admin
      .from("budget_categories")
      .update({ category_id: reassignTo })
      .eq("category_id", id);
    await admin
      .from("category_rules")
      .update({ category_id: reassignTo })
      .eq("category_id", id);
  } else {
    // No reassignment: null out on tables that allow it; wipe rules.
    await admin
      .from("transactions")
      .update({ category_id: null })
      .eq("category_id", id);
    await admin.from("bills").update({ category_id: null }).eq("category_id", id);
    await admin
      .from("subscriptions")
      .update({ category_id: null })
      .eq("category_id", id);
    await admin
      .from("budget_categories")
      .delete()
      .eq("category_id", id);
    await admin.from("category_rules").delete().eq("category_id", id);
  }

  // Orphan children: re-parent to this category's parent, or null.
  const { data: parentRow } = await admin
    .from("categories")
    .select("parent_id")
    .eq("id", id)
    .maybeSingle();
  await admin
    .from("categories")
    .update({ parent_id: parentRow?.parent_id ?? null })
    .eq("parent_id", id);

  const { error } = await admin.from("categories").delete().eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
