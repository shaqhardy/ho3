import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { admin } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    nickname?: string | null;
  };
  const raw = typeof body.nickname === "string" ? body.nickname.trim() : null;
  const nickname = raw && raw.length > 0 ? raw.slice(0, 100) : null;

  const { error } = await admin
    .from("accounts")
    .update({ nickname })
    .eq("id", id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true, nickname });
}
