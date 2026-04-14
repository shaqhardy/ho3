import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Book = "personal" | "business" | "nonprofit";
type Lifecycle = "active" | "paused" | "cancelled";

interface Body {
  lifecycle: Lifecycle;
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

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!["active", "paused", "cancelled"].includes(body.lifecycle))
    return NextResponse.json({ error: "Invalid lifecycle" }, { status: 400 });

  const admin = await createServiceClient();
  const { data: bill } = await admin
    .from("bills")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();
  if (!bill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(bill.book as Book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await admin.from("bills").update({ lifecycle: body.lifecycle }).eq("id", id);
  return NextResponse.json({ success: true });
}
