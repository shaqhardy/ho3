import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { createServiceClient } from "@/lib/supabase/server";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

export type AlertType =
  | "bills_due"
  | "shortfall_warning"
  | "plaid_sync_errors"
  | "daily_summary"
  | "test"
  | "large_txn"
  | "income"
  | "low_balance"
  | "bill_paid"
  | "bill_not_paid"
  | "subscription_renewal"
  | "debt_milestone"
  | "plaid_reconnect"
  | "category_overspend"
  | "goal_hit"
  | "statement_available";

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error("VAPID env vars missing");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
}

/**
 * Send a push notification to all enabled subscriptions for a given user.
 * - Logs to notifications_log (skips if dedup_key already exists for this user).
 * - Removes stale subscriptions (404/410 from push service).
 *
 * Returns counts of sent/failed deliveries.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  dedupKey: string,
  alertType: AlertType
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  ensureVapid();
  const supabase = await createServiceClient();

  // Dedup: if we've already sent this dedup_key for this user, skip.
  if (dedupKey) {
    const { data: existing } = await supabase
      .from("notifications_log")
      .select("id")
      .eq("user_id", userId)
      .eq("dedup_key", dedupKey)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return { sent: 0, failed: 0, skipped: true };
    }
  }

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, enabled")
    .eq("user_id", userId)
    .eq("enabled", true);

  const subscriptions = (subs ?? []) as PushSubscriptionRow[];
  if (!subscriptions.length) {
    // Still log so dedup works next run (no devices, but don't repeat work).
    await supabase.from("notifications_log").insert({
      user_id: userId,
      alert_type: alertType,
      dedup_key: dedupKey,
      title: payload.title,
      body: payload.body,
      url: payload.url ?? null,
      sent_count: 0,
      failed_count: 0,
    });
    return { sent: 0, failed: 0, skipped: false };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    data: payload.data,
  });

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      const pushSub: WebPushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(pushSub, body, { TTL: 60 * 60 * 24 });
        sent++;
      } catch (err) {
        failed++;
        const e = err as { statusCode?: number };
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          staleIds.push(sub.id);
        } else {
          console.error("[push] sendNotification error", err);
        }
      }
    })
  );

  if (staleIds.length) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  await supabase.from("notifications_log").insert({
    user_id: userId,
    alert_type: alertType,
    dedup_key: dedupKey,
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
    sent_count: sent,
    failed_count: failed,
  });

  return { sent, failed, skipped: false };
}
