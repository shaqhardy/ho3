import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

interface Body {
  custom_milestone_threshold?: number | string | null;
  original_balance?: number | string | null;
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
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  function coerce(v: unknown): number | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  }

  const customThreshold = coerce(body.custom_milestone_threshold);
  const originalBalance = coerce(body.original_balance);

  if (customThreshold === undefined && originalBalance === undefined) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Verify access via book.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();

  const admin = await createServiceClient();
  const { data: debt, error: debtErr } = await admin
    .from("debts")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();

  if (debtErr || !debt) {
    return NextResponse.json({ error: "Debt not found" }, { status: 404 });
  }

  const isAdmin = profile?.role === "admin";
  const allowed = (profile?.allowed_books ?? []) as string[];
  if (!isAdmin && !allowed.includes(debt.book)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update: Record<string, number | null> = {};
  if (customThreshold !== undefined) {
    if (customThreshold !== null && customThreshold < 0) {
      return NextResponse.json(
        { error: "custom_milestone_threshold must be >= 0" },
        { status: 400 }
      );
    }
    update.custom_milestone_threshold = customThreshold;
  }
  if (originalBalance !== undefined) {
    if (originalBalance !== null && originalBalance < 0) {
      return NextResponse.json(
        { error: "original_balance must be >= 0" },
        { status: 400 }
      );
    }
    update.original_balance = originalBalance;
  }

  const { error } = await admin.from("debts").update(update).eq("id", id);
  if (error) {
    console.error("[debts/milestones PATCH] update error", error);
    return NextResponse.json(
      { error: "Failed to update milestones" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ...update });
}
