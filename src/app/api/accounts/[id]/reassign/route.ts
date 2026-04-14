import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

const BOOKS = ["personal", "business", "nonprofit"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { admin } = gate;

  const body = (await request.json().catch(() => ({}))) as { book?: string };
  if (!body.book || !BOOKS.includes(body.book as (typeof BOOKS)[number])) {
    return NextResponse.json({ error: "Invalid book" }, { status: 400 });
  }
  const book = body.book as (typeof BOOKS)[number];

  const { error } = await admin
    .from("accounts")
    .update({ book })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  // Cascade to transactions so history moves with the account.
  await admin.from("transactions").update({ book }).eq("account_id", id);

  return NextResponse.json({ success: true, book });
}
