import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; contribId: string }> }
) {
  const { id, contribId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify ownership via goal
  const { data: goal } = await supabase
    .from("goals")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!goal)
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });

  await supabase
    .from("goal_contributions")
    .delete()
    .eq("id", contribId)
    .eq("goal_id", id);

  return NextResponse.json({ success: true });
}
