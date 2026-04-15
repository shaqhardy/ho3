import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { aiCategorizeFreshTxns } from "@/lib/ai/sync-hook";

export const runtime = "nodejs";

interface Body {
  transaction_ids?: string[];
}

export async function POST(request: NextRequest) {
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
  const ids = (body.transaction_ids ?? []).filter(
    (x): x is string => typeof x === "string" && x.length > 0
  );
  if (ids.length === 0)
    return NextResponse.json({ success: true, stats: null });

  const admin = await createServiceClient();
  const stats = await aiCategorizeFreshTxns(admin, ids);
  return NextResponse.json({ success: true, stats });
}
