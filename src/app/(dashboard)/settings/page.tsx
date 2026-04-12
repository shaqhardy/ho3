import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SettingsView } from "@/components/settings-view";

export default async function SettingsPage() {
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

  const { data: preferences } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, enabled, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <SettingsView
      profile={profile}
      preferences={preferences}
      subscriptions={subscriptions || []}
    />
  );
}
