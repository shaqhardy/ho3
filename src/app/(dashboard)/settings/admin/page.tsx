import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AdminView } from "@/components/admin-view";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/settings");
  }

  const admin = await createServiceClient();

  // All profiles
  const { data: allProfiles } = await admin
    .from("profiles")
    .select("*")
    .order("created_at");

  // For each, look up their MFA factors
  const withMfa = await Promise.all(
    (allProfiles || []).map(async (p) => {
      const { data: factorsData } = await admin.auth.admin.mfa.listFactors({
        userId: p.id,
      });
      const verified = (factorsData?.factors || []).filter(
        (f) => f.status === "verified"
      );
      const { data: backupCodes } = await admin
        .from("mfa_backup_codes")
        .select("used_at")
        .eq("user_id", p.id);
      const backupTotal = backupCodes?.length || 0;
      const backupRemaining =
        backupCodes?.filter((c) => !c.used_at).length || 0;

      return {
        profile: p,
        mfa_enabled: verified.length > 0,
        mfa_factor_count: verified.length,
        backup_codes_remaining: backupRemaining,
        backup_codes_total: backupTotal,
        is_self: p.id === user.id,
      };
    })
  );

  // Recent admin actions log
  const { data: recentActions } = await admin
    .from("mfa_admin_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  // Resolve user names for actions
  const userMap = new Map(
    (allProfiles || []).map((p) => [p.id, p.full_name || p.email])
  );
  const actionsWithNames =
    recentActions?.map((a) => ({
      ...a,
      admin_name: userMap.get(a.admin_user_id) || "Unknown",
      target_name: userMap.get(a.target_user_id) || "Unknown",
    })) || [];

  return (
    <AdminView
      users={withMfa}
      recentActions={actionsWithNames}
    />
  );
}
