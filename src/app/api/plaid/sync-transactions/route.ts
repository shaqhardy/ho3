import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { syncLiabilities } from "@/lib/plaid/sync-liabilities";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get all Plaid items
  const { data: plaidItems } = await adminSupabase
    .from("plaid_items")
    .select("*");

  if (!plaidItems?.length) {
    return NextResponse.json({ error: "No Plaid items found" }, { status: 404 });
  }

  const plaidBaseUrl =
    process.env.PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : "https://sandbox.plaid.com";

  let totalAdded = 0;
  let totalModified = 0;

  for (const item of plaidItems) {
    // Sync transactions using cursor-based pagination
    let hasMore = true;
    let cursor = item.cursor || undefined;

    while (hasMore) {
      const syncResponse = await fetch(`${plaidBaseUrl}/transactions/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.PLAID_CLIENT_ID,
          secret: process.env.PLAID_SECRET,
          access_token: item.plaid_access_token,
          cursor,
          count: 500,
        }),
      });

      const syncData = await syncResponse.json();

      if (!syncResponse.ok) {
        console.error("Plaid sync error:", syncData);
        break;
      }

      // Get account-to-book mapping
      const { data: accounts } = await adminSupabase
        .from("accounts")
        .select("plaid_account_id, book")
        .eq("plaid_item_id", item.plaid_item_id);

      const accountBookMap = new Map(
        (accounts || []).map((a) => [a.plaid_account_id, a.book])
      );

      // Process added transactions
      for (const txn of syncData.added || []) {
        const book = accountBookMap.get(txn.account_id) || "personal";

        // Check for auto-categorization rule
        const { data: rules } = await adminSupabase
          .from("category_rules")
          .select("category_id")
          .eq("book", book)
          .ilike("merchant_pattern", `%${txn.merchant_name || txn.name}%`)
          .limit(1);

        const categoryId = rules?.[0]?.category_id || null;

        // Plaid amounts: positive = money leaving account (expense)
        // We store expenses as positive, income as negative (matching Plaid)
        const isIncome = txn.amount < 0;

        await adminSupabase.from("transactions").upsert(
          {
            plaid_transaction_id: txn.transaction_id,
            account_id: (
              await adminSupabase
                .from("accounts")
                .select("id")
                .eq("plaid_account_id", txn.account_id)
                .single()
            ).data?.id,
            book,
            date: txn.date,
            amount: Math.abs(txn.amount),
            merchant: txn.merchant_name || txn.name,
            description: txn.name,
            category_id: categoryId,
            is_income: isIncome,
          },
          { onConflict: "plaid_transaction_id" }
        );

        // Auto-create category rule if merchant is new
        if (categoryId && txn.merchant_name) {
          const { data: existingRule } = await adminSupabase
            .from("category_rules")
            .select("id")
            .eq("merchant_pattern", txn.merchant_name)
            .eq("book", book)
            .limit(1);

          if (!existingRule?.length) {
            await adminSupabase.from("category_rules").insert({
              merchant_pattern: txn.merchant_name,
              category_id: categoryId,
              book,
            });
          }
        }
      }

      // Process modified transactions
      for (const txn of syncData.modified || []) {
        await adminSupabase
          .from("transactions")
          .update({
            amount: Math.abs(txn.amount),
            merchant: txn.merchant_name || txn.name,
            description: txn.name,
            date: txn.date,
            is_income: txn.amount < 0,
          })
          .eq("plaid_transaction_id", txn.transaction_id);
      }

      // Process removed transactions
      for (const txn of syncData.removed || []) {
        await adminSupabase
          .from("transactions")
          .delete()
          .eq("plaid_transaction_id", txn.transaction_id);
      }

      totalAdded += (syncData.added || []).length;
      totalModified += (syncData.modified || []).length;

      cursor = syncData.next_cursor;
      hasMore = syncData.has_more;

      // Update cursor on the Plaid item
      await adminSupabase
        .from("plaid_items")
        .update({ cursor })
        .eq("id", item.id);
    }

    // Also refresh account balances
    const balanceResponse = await fetch(`${plaidBaseUrl}/accounts/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token: item.plaid_access_token,
      }),
    });

    const balanceData = await balanceResponse.json();

    if (balanceData.accounts) {
      for (const account of balanceData.accounts) {
        await adminSupabase
          .from("accounts")
          .update({
            current_balance: account.balances.current || 0,
            available_balance: account.balances.available,
            last_synced_at: new Date().toISOString(),
          })
          .eq("plaid_account_id", account.account_id);
      }
    }
  }

  // Sync liabilities and recalculate payoff projections
  const liabilitiesSynced = await syncLiabilities(adminSupabase, plaidItems);

  return NextResponse.json({
    success: true,
    added: totalAdded,
    modified: totalModified,
    liabilities_synced: liabilitiesSynced,
  });
}
