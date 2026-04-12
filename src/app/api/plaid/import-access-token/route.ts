import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Admin-only endpoint to import existing Plaid access tokens
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { access_token, item_id, institution_name, user_id, book } =
    await request.json();

  const plaidBaseUrl =
    process.env.PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : "https://sandbox.plaid.com";

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Store the Plaid item
  await adminSupabase.from("plaid_items").upsert(
    {
      user_id,
      plaid_item_id: item_id,
      plaid_access_token: access_token,
      institution_name: institution_name || null,
    },
    { onConflict: "plaid_item_id" }
  );

  // Fetch and store accounts
  const accountsResponse = await fetch(`${plaidBaseUrl}/accounts/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      access_token,
    }),
  });

  const accountsData = await accountsResponse.json();

  if (!accountsResponse.ok) {
    return NextResponse.json(
      { error: accountsData.error_message || "Failed to fetch accounts" },
      { status: 400 }
    );
  }

  const importedAccounts = [];
  for (const account of accountsData.accounts || []) {
    const { data } = await adminSupabase
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
          book: book || "personal",
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "plaid_account_id" }
      )
      .select();

    if (data) importedAccounts.push(...data);
  }

  return NextResponse.json({
    success: true,
    accounts: importedAccounts,
  });
}
