import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { public_token, institution } = await request.json();

  // Exchange public token for access token
  const exchangeResponse = await fetch(
    `https://${process.env.PLAID_ENV === "production" ? "production" : "sandbox"}.plaid.com/item/public_token/exchange`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        public_token,
      }),
    }
  );

  const exchangeData = await exchangeResponse.json();

  if (!exchangeResponse.ok) {
    return NextResponse.json(
      { error: exchangeData.error_message || "Exchange failed" },
      { status: 400 }
    );
  }

  const { access_token, item_id } = exchangeData;

  // Store the Plaid item
  const { createClient: createServiceClient } = await import(
    "@supabase/supabase-js"
  );
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await adminSupabase.from("plaid_items").insert({
    user_id: user.id,
    plaid_item_id: item_id,
    plaid_access_token: access_token,
    institution_name: institution?.name || null,
  });

  // Fetch and store accounts
  const accountsResponse = await fetch(
    `https://${process.env.PLAID_ENV === "production" ? "production" : "sandbox"}.plaid.com/accounts/get`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token,
      }),
    }
  );

  const accountsData = await accountsResponse.json();

  if (accountsData.accounts) {
    for (const account of accountsData.accounts) {
      await adminSupabase.from("accounts").upsert(
        {
          plaid_account_id: account.account_id,
          plaid_item_id: item_id,
          name: account.name,
          current_balance: account.balances.current || 0,
          available_balance: account.balances.available,
          type: account.type,
          subtype: account.subtype,
          mask: account.mask,
          book: "personal", // Default to personal, user can reassign
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "plaid_account_id" }
      );
    }
  }

  return NextResponse.json({
    success: true,
    accounts_added: accountsData.accounts?.length || 0,
  });
}
