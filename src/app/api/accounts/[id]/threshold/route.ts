import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

interface Body {
  low_balance_threshold?: number | string | null;
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

  let threshold: number | null = null;
  if (body.low_balance_threshold === null) {
    threshold = null;
  } else if (typeof body.low_balance_threshold === "number") {
    threshold = body.low_balance_threshold;
  } else if (typeof body.low_balance_threshold === "string") {
    const n = Number(body.low_balance_threshold);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "Invalid threshold" }, { status: 400 });
    }
    threshold = n;
  } else {
    return NextResponse.json({ error: "Missing threshold" }, { status: 400 });
  }

  if (threshold !== null && threshold < 0) {
    return NextResponse.json({ error: "Threshold must be >= 0" }, { status: 400 });
  }

  // Verify user has access to this account via their allowed_books.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();

  const admin = await createServiceClient();
  const { data: account, error: accErr } = await admin
    .from("accounts")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();

  if (accErr || !account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const isAdmin = profile?.role === "admin";
  const allowed = (profile?.allowed_books ?? []) as string[];
  if (!isAdmin && !allowed.includes(account.book)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await admin
    .from("accounts")
    .update({ low_balance_threshold: threshold })
    .eq("id", id);

  if (error) {
    console.error("[accounts/threshold PATCH] update error", error);
    return NextResponse.json(
      { error: "Failed to update threshold" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, low_balance_threshold: threshold });
}
