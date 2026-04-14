import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { AccountsView } from "@/components/accounts/accounts-view";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
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
  if (!profile) redirect("/login");

  // Housekeeping: purge any pending_deletions whose undo window expired while
  // the user wasn't on the page. Cheap: usually finds nothing.
  const admin = await createServiceClient();
  const nowIso = new Date().toISOString();
  const { data: expired } = await admin
    .from("pending_deletions")
    .select("id, entity_type, entity_id")
    .is("executed_at", null)
    .is("undone_at", null)
    .lt("scheduled_purge_at", nowIso);

  for (const pd of (expired ?? []) as Array<{
    id: string;
    entity_type: string;
    entity_id: string;
  }>) {
    try {
      if (pd.entity_type === "account") {
        await admin.from("scenarios").delete().eq("account_id", pd.entity_id);
        await admin
          .from("goals")
          .update({ linked_account_id: null })
          .eq("linked_account_id", pd.entity_id);
        await admin.from("transactions").delete().eq("account_id", pd.entity_id);
        await admin.from("debts").delete().eq("account_id", pd.entity_id);
        await admin.from("bills").update({ account_id: null }).eq("account_id", pd.entity_id);
        await admin
          .from("subscriptions")
          .update({ account_id: null })
          .eq("account_id", pd.entity_id);
        await admin.from("accounts").delete().eq("id", pd.entity_id);
      } else if (pd.entity_type === "plaid_item") {
        const { data: item } = await admin
          .from("plaid_items")
          .select("*")
          .eq("id", pd.entity_id)
          .maybeSingle();
        if (item) {
          const { data: accts } = await admin
            .from("accounts")
            .select("id")
            .eq("plaid_item_id", item.plaid_item_id);
          for (const a of (accts ?? []) as { id: string }[]) {
            await admin.from("scenarios").delete().eq("account_id", a.id);
            await admin
              .from("goals")
              .update({ linked_account_id: null })
              .eq("linked_account_id", a.id);
            await admin.from("transactions").delete().eq("account_id", a.id);
            await admin.from("debts").delete().eq("account_id", a.id);
            await admin.from("bills").update({ account_id: null }).eq("account_id", a.id);
            await admin
              .from("subscriptions")
              .update({ account_id: null })
              .eq("account_id", a.id);
            await admin.from("accounts").delete().eq("id", a.id);
          }
          try {
            const plaidBase =
              process.env.PLAID_ENV === "production"
                ? "https://production.plaid.com"
                : "https://sandbox.plaid.com";
            await fetch(`${plaidBase}/item/remove`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                client_id: process.env.PLAID_CLIENT_ID,
                secret: process.env.PLAID_SECRET,
                access_token: item.plaid_access_token,
              }),
            });
          } catch {
            // best-effort
          }
          await admin.from("plaid_items").delete().eq("id", pd.entity_id);
        }
      }
      await admin
        .from("pending_deletions")
        .update({ executed_at: new Date().toISOString() })
        .eq("id", pd.id);
    } catch (err) {
      console.error("[accounts page] purge error", err);
    }
  }

  // Load banks + accounts for this admin. Only visible (is_hidden = false) accounts
  // surface on book dashboards, but this page shows everything incl. pending-delete.
  const [{ data: items }, { data: accounts }] = await Promise.all([
    admin
      .from("plaid_items")
      .select(
        "id, plaid_item_id, institution_name, needs_reauth, last_error, last_error_at, pending_delete_id, created_at"
      )
      .order("created_at"),
    admin
      .from("accounts")
      .select(
        "id, book, name, nickname, type, subtype, mask, current_balance, available_balance, last_synced_at, plaid_item_id, is_hidden, pending_delete_id"
      )
      .order("name"),
  ]);

  return (
    <AccountsView
      isAdmin={profile.role === "admin"}
      allowedBooks={profile.allowed_books || []}
      items={items || []}
      accounts={accounts || []}
    />
  );
}
