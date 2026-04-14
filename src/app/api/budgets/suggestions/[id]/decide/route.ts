import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Decision = "accepted" | "rejected" | "dismissed";

interface Body {
  decision: Decision;
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
  if (!["accepted", "rejected", "dismissed"].includes(body.decision))
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });

  const admin = await createServiceClient();
  const { data: sug } = await admin
    .from("budget_suggestions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!sug) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If accepted, actually apply the new allocation to the budget_categories row.
  if (body.decision === "accepted") {
    await admin
      .from("budget_categories")
      .update({ allocated_amount: sug.proposed_amount })
      .eq("id", sug.budget_category_id);
    await admin.from("budget_adjustments").insert({
      budget_category_id: sug.budget_category_id,
      old_amount: sug.old_amount,
      new_amount: sug.proposed_amount,
      reason: `Accepted tune-up: ${sug.reason}`,
      adjusted_by: user.id,
    });
  }

  await admin
    .from("budget_suggestions")
    .update({
      status: body.decision,
      decided_at: new Date().toISOString(),
      decided_by: user.id,
    })
    .eq("id", id);

  return NextResponse.json({ success: true, decision: body.decision });
}
