import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { syncPlaidItemNow } from "@/lib/plaid/sync-item";

export const runtime = "nodejs";
export const maxDuration = 60;

type WebhookBody = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string } | null;
  // TRANSACTIONS_REMOVED
  removed_transactions?: string[];
  // HISTORICAL_UPDATE / DEFAULT_UPDATE (legacy /transactions/get path)
  new_transactions?: number;
};

/**
 * Plaid webhook. We authenticate via a shared secret in the query string so
 * we don't need to stand up JWT/JWK verification yet — the URL itself is the
 * bearer token, and Plaid accepts arbitrary query params on the webhook URL
 * set via /link/token/create or /item/webhook/update.
 *
 * Dispatch strategy: for anything that signals new transactions are available
 * (TRANSACTIONS SYNC_UPDATES_AVAILABLE, INITIAL_UPDATE, HISTORICAL_UPDATE,
 * DEFAULT_UPDATE), re-run the item sync with its stored cursor. Plaid's
 * /transactions/sync is idempotent — safe to call on any signal.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.PLAID_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[plaid webhook] PLAID_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }
  const supplied = request.nextUrl.searchParams.get("k");
  if (supplied !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = (await request.json()) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const type = body.webhook_type;
  const code = body.webhook_code;
  const plaidItemId = body.item_id;

  console.log(`[plaid webhook] ${type}/${code} item=${plaidItemId ?? "?"}`);

  if (!plaidItemId) return NextResponse.json({ ok: true, skipped: "no item_id" });

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: item } = await admin
    .from("plaid_items")
    .select(
      "id, user_id, plaid_item_id, plaid_access_token, institution_name, cursor"
    )
    .eq("plaid_item_id", plaidItemId)
    .maybeSingle();
  if (!item) {
    console.warn(`[plaid webhook] unknown plaid_item_id=${plaidItemId}`);
    return NextResponse.json({ ok: true, skipped: "item not found" });
  }

  if (type === "TRANSACTIONS") {
    switch (code) {
      case "SYNC_UPDATES_AVAILABLE":
      case "INITIAL_UPDATE":
      case "HISTORICAL_UPDATE":
      case "DEFAULT_UPDATE": {
        // Sync with stored cursor — Plaid will deliver whatever batch is ready.
        // HISTORICAL_UPDATE arrives once the full days_requested backfill is
        // complete; subsequent SYNC_UPDATES_AVAILABLE handle ongoing deltas.
        const result = await syncPlaidItemNow(admin, item);
        return NextResponse.json({
          ok: true,
          code,
          added: result.added,
          modified: result.modified,
          removed: result.removed,
          balances_refreshed: result.balances_refreshed,
          error: result.error,
        });
      }
      case "TRANSACTIONS_REMOVED": {
        if (body.removed_transactions?.length) {
          await admin
            .from("transactions")
            .delete()
            .in("plaid_transaction_id", body.removed_transactions);
        }
        return NextResponse.json({
          ok: true,
          removed: body.removed_transactions?.length ?? 0,
        });
      }
    }
  }

  if (type === "ITEM") {
    if (code === "ERROR" && body.error?.error_code === "ITEM_LOGIN_REQUIRED") {
      await admin
        .from("plaid_items")
        .update({
          needs_reauth: true,
          last_error: "ITEM_LOGIN_REQUIRED",
          last_error_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      return NextResponse.json({ ok: true, flagged_reauth: true });
    }
    if (code === "LOGIN_REPAIRED" || code === "PENDING_EXPIRATION" || code === "NEW_ACCOUNTS_AVAILABLE") {
      // Re-sync to pick up state changes / new accounts.
      await syncPlaidItemNow(admin, item);
      return NextResponse.json({ ok: true, resynced: true });
    }
  }

  // Unknown webhook — ack so Plaid stops retrying.
  return NextResponse.json({ ok: true, ignored: `${type}/${code}` });
}

// Plaid sometimes probes with GET when setting up webhooks — just ack.
export async function GET() {
  return NextResponse.json({ ok: true });
}
