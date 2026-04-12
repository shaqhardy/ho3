import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { hashCode } from "@/lib/mfa/backup-codes";

/**
 * Recovery flow: user has an active AAL1 session (password OK) but lost
 * their authenticator. They submit a backup code; if valid, we:
 *   1. Mark the code used
 *   2. Unenroll their TOTP factor via admin API
 *   3. Sign them out
 * They then re-login and go through /mfa/enroll for a fresh authenticator.
 *
 * Returns { success: true } — the client then does signOut + redirects.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { code } = await request.json();
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Code required" }, { status: 400 });
  }

  const admin = await createServiceClient();
  const hash = hashCode(code);

  // Find an unused code matching this user
  const { data: match } = await admin
    .from("mfa_backup_codes")
    .select("id")
    .eq("user_id", user.id)
    .eq("code_hash", hash)
    .is("used_at", null)
    .limit(1)
    .maybeSingle();

  if (!match) {
    return NextResponse.json(
      { error: "Invalid or already-used recovery code" },
      { status: 400 }
    );
  }

  // Mark the code as used
  await admin
    .from("mfa_backup_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", match.id);

  // Unenroll all TOTP factors for this user via admin API
  try {
    const { data: factorsData } = await admin.auth.admin.mfa.listFactors({
      userId: user.id,
    });
    for (const factor of factorsData?.factors || []) {
      await admin.auth.admin.mfa.deleteFactor({
        userId: user.id,
        id: factor.id,
      });
    }
  } catch (err) {
    console.error("[mfa-recovery] factor cleanup failed:", err);
    // Fail-soft: still return success so user can proceed; they'll re-enroll
  }

  return NextResponse.json({ success: true });
}
