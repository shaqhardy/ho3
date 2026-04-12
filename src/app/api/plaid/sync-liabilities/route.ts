import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

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

  let synced = 0;

  for (const item of plaidItems) {
    const response = await fetch(`${plaidBaseUrl}/liabilities/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token: item.plaid_access_token,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Liabilities not supported for this item — skip silently
      if (data.error_code === "PRODUCTS_NOT_SUPPORTED") continue;
      console.error("Liabilities error:", data);
      continue;
    }

    // Process credit card liabilities
    for (const card of data.liabilities?.credit || []) {
      const accountId = card.account_id;

      // Find the matching account in our DB
      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book")
        .eq("plaid_account_id", accountId)
        .single();

      if (!account) continue;

      const apr =
        card.aprs?.find(
          (a: { apr_type: string }) => a.apr_type === "purchase_apr"
        )?.apr_percentage || 0;

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor: card.account_id, // Will be overwritten with account name below
          current_balance: Math.abs(card.last_statement_balance || 0),
          apr,
          minimum_payment: card.minimum_payment_amount || 0,
          statement_due_date:
            card.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
        },
        { onConflict: "account_id" }
      );

      // Update creditor name from the account
      const { data: acct } = await adminSupabase
        .from("accounts")
        .select("name")
        .eq("id", account.id)
        .single();

      if (acct) {
        await adminSupabase
          .from("debts")
          .update({ creditor: acct.name })
          .eq("account_id", account.id);
      }

      synced++;
    }

    // Process student loan liabilities
    for (const loan of data.liabilities?.student || []) {
      const accountId = loan.account_id;

      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book")
        .eq("plaid_account_id", accountId)
        .single();

      if (!account) continue;

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor: loan.servicer_address?.organization || "Student Loan",
          current_balance: Math.abs(
            loan.outstanding_interest_amount +
              (loan.last_statement_balance || 0)
          ),
          apr: loan.interest_rate_percentage || 0,
          minimum_payment: loan.minimum_payment_amount || 0,
          statement_due_date:
            loan.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
        },
        { onConflict: "account_id" }
      );

      synced++;
    }

    // Process mortgage liabilities
    for (const mortgage of data.liabilities?.mortgage || []) {
      const accountId = mortgage.account_id;

      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book")
        .eq("plaid_account_id", accountId)
        .single();

      if (!account) continue;

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor: mortgage.servicer_address?.organization || "Mortgage",
          current_balance: Math.abs(
            mortgage.current_late_fee +
              (mortgage.last_payment_amount || 0) +
              (mortgage.outstanding_principal || 0)
          ),
          apr: mortgage.interest_rate?.percentage || 0,
          minimum_payment: mortgage.next_monthly_payment || 0,
          statement_due_date:
            mortgage.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
        },
        { onConflict: "account_id" }
      );

      synced++;
    }
  }

  return NextResponse.json({ success: true, synced });
}
