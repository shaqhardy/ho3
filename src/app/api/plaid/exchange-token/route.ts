import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidFetch } from "@/lib/plaid/api";
import { syncPlaidItemNow } from "@/lib/plaid/sync-item";

export const runtime = "nodejs";
// Transactions sync can take 10–30s for banks with long history. Give the
// request room to complete in the same round-trip so the UI doesn't have to
// poll.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { public_token, institution, book: bookRaw } = await request.json();
  const ALLOWED_BOOKS = ["personal", "business", "nonprofit"] as const;
  type BookT = (typeof ALLOWED_BOOKS)[number];
  const book: BookT = ALLOWED_BOOKS.includes(bookRaw)
    ? (bookRaw as BookT)
    : "personal";

  const { ok: exOk, data: exData } = await plaidFetch<{
    access_token: string;
    item_id: string;
  }>("/item/public_token/exchange", { public_token });
  if (!exOk) {
    return NextResponse.json(
      { error: exData.error_message || "Exchange failed" },
      { status: 400 }
    );
  }
  const { access_token, item_id } = exData;

  const { createClient: createServiceClient } = await import(
    "@supabase/supabase-js"
  );
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: itemRow } = await adminSupabase
    .from("plaid_items")
    .insert({
      user_id: user.id,
      plaid_item_id: item_id,
      plaid_access_token: access_token,
      institution_name: institution?.name || null,
    })
    .select("id, user_id, plaid_item_id, plaid_access_token, institution_name, cursor")
    .single();

  // Accounts — quick call, always worth finishing inline so the user sees the
  // bank on return.
  const { ok: acctOk, data: acctData } = await plaidFetch<{
    accounts?: Array<{
      account_id: string;
      name: string;
      balances: { current: number | null; available: number | null };
      type: string;
      subtype: string | null;
      mask: string | null;
    }>;
  }>("/accounts/get", { access_token });

  let accountsAdded = 0;
  const insertedAccounts: Array<{
    id: string;
    name: string;
    mask: string | null;
    type: string;
    subtype: string | null;
    book: BookT;
  }> = [];
  if (acctOk && acctData.accounts) {
    for (const account of acctData.accounts) {
      const { data: row } = await adminSupabase
        .from("accounts")
        .upsert(
          {
            plaid_account_id: account.account_id,
            plaid_item_id: item_id,
            name: account.name,
            current_balance: account.balances.current || 0,
            available_balance: account.balances.available,
            type: account.type,
            subtype: account.subtype,
            mask: account.mask,
            book,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "plaid_account_id" }
        )
        .select("id, name, mask, type, subtype, book")
        .single();
      if (row) {
        insertedAccounts.push({
          id: row.id as string,
          name: row.name as string,
          mask: (row.mask as string | null) ?? null,
          type: row.type as string,
          subtype: (row.subtype as string | null) ?? null,
          book: row.book as BookT,
        });
      }
      accountsAdded++;
    }
  }

  // Kick off the first transactions sync. Previously this only ran via the
  // daily cron — banks connected after the cron window showed no transactions
  // until the following day.
  let txnsAdded = 0;
  let syncError: string | undefined;
  if (itemRow) {
    const syncResult = await syncPlaidItemNow(adminSupabase, itemRow);
    if (syncResult.ok) {
      txnsAdded = syncResult.added;
    } else {
      syncError = syncResult.error;
      console.error("[exchange-token] initial sync error", syncError);
    }
  }

  return NextResponse.json({
    success: true,
    accounts_added: accountsAdded,
    transactions_added: txnsAdded,
    sync_error: syncError,
    book,
    accounts: insertedAccounts,
  });
}
