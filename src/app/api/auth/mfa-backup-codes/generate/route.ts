import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { generateBackupCodes } from "@/lib/mfa/backup-codes";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await createServiceClient();

  // Wipe any existing codes for this user
  await admin.from("mfa_backup_codes").delete().eq("user_id", user.id);

  // Generate new set
  const { plaintext, hashes } = generateBackupCodes();

  const rows = hashes.map((h) => ({ user_id: user.id, code_hash: h }));
  const { error } = await admin.from("mfa_backup_codes").insert(rows);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Plaintext is returned ONCE here, never again.
  return NextResponse.json({ codes: plaintext });
}
