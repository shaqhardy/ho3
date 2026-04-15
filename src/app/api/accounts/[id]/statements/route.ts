import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
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

  // Verify book access using the user's profile.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();

  const admin = await createServiceClient();
  const { data: account } = await admin
    .from("accounts")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const isAdmin = profile?.role === "admin";
  const allowed = (profile?.allowed_books ?? []) as string[];
  if (!isAdmin && !allowed.includes(account.book)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: statements, error } = await admin
    .from("account_statements")
    .select(
      "id, account_id, plaid_statement_id, period_start, period_end, opening_balance, closing_balance, total_debits, total_credits, storage_path, byte_size, downloaded_at, created_at"
    )
    .eq("account_id", id)
    .order("period_end", { ascending: false });

  if (error) {
    console.error("[accounts/statements GET] query error", error);
    return NextResponse.json(
      { error: "Failed to load statements" },
      { status: 500 }
    );
  }

  return NextResponse.json({ statements: statements ?? [] });
}
