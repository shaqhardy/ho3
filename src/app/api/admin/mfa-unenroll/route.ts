import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the caller is an admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { targetUserId, reason } = await request.json();
  if (!targetUserId) {
    return NextResponse.json(
      { error: "targetUserId required" },
      { status: 400 }
    );
  }

  const admin = await createServiceClient();

  // List and delete all factors for the target user
  const { data: factorsData, error: listErr } =
    await admin.auth.admin.mfa.listFactors({ userId: targetUserId });

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const deletedFactors: string[] = [];
  for (const factor of factorsData?.factors || []) {
    const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({
      userId: targetUserId,
      id: factor.id,
    });
    if (!delErr) deletedFactors.push(factor.friendly_name || factor.id);
  }

  // Also wipe their backup codes so they'll be prompted to regenerate
  await admin
    .from("mfa_backup_codes")
    .delete()
    .eq("user_id", targetUserId);

  // Audit log
  await admin.from("mfa_admin_actions").insert({
    admin_user_id: user.id,
    target_user_id: targetUserId,
    action: "unenroll_totp",
    reason: reason || null,
  });

  return NextResponse.json({
    success: true,
    deleted_factors: deletedFactors.length,
  });
}
