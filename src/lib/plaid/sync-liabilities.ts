import { SupabaseClient } from "@supabase/supabase-js";

function calculatePayoff(
  balance: number,
  apr: number,
  minPayment: number
): { months: number; totalInterest: number } {
  if (minPayment <= 0 || balance <= 0) return { months: 0, totalInterest: 0 };

  const monthlyRate = apr / 100 / 12;
  let remaining = balance;
  let months = 0;
  let totalInterest = 0;

  while (remaining > 0 && months < 600) {
    const interest = remaining * monthlyRate;
    totalInterest += interest;
    const principal = Math.min(minPayment - interest, remaining);
    if (principal <= 0) return { months: 999, totalInterest: 999999 };
    remaining -= principal;
    months++;
  }

  return { months, totalInterest };
}

export async function syncLiabilities(
  adminSupabase: SupabaseClient,
  plaidItems: { plaid_access_token: string; plaid_item_id: string }[]
) {
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
      if (data.error_code === "PRODUCTS_NOT_SUPPORTED") continue;
      console.error("Liabilities error:", data);
      continue;
    }

    // Process credit card liabilities
    for (const card of data.liabilities?.credit || []) {
      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book, name")
        .eq("plaid_account_id", card.account_id)
        .single();

      if (!account) continue;

      const apr =
        card.aprs?.find(
          (a: { apr_type: string }) => a.apr_type === "purchase_apr"
        )?.apr_percentage || 0;
      const balance = Math.abs(card.last_statement_balance || 0);
      const minPayment = card.minimum_payment_amount || 0;
      const payoff = calculatePayoff(balance, apr, minPayment);

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor: account.name,
          current_balance: balance,
          apr,
          minimum_payment: minPayment,
          statement_due_date:
            card.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
          projected_payoff_months: payoff.months,
          projected_total_interest: payoff.totalInterest,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      );

      synced++;
    }

    // Process student loan liabilities
    for (const loan of data.liabilities?.student || []) {
      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book, name")
        .eq("plaid_account_id", loan.account_id)
        .single();

      if (!account) continue;

      const balance = Math.abs(
        (loan.outstanding_interest_amount || 0) +
          (loan.last_statement_balance || 0)
      );
      const apr = loan.interest_rate_percentage || 0;
      const minPayment = loan.minimum_payment_amount || 0;
      const payoff = calculatePayoff(balance, apr, minPayment);

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor:
            loan.servicer_address?.organization || account.name,
          current_balance: balance,
          apr,
          minimum_payment: minPayment,
          statement_due_date:
            loan.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
          projected_payoff_months: payoff.months,
          projected_total_interest: payoff.totalInterest,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      );

      synced++;
    }

    // Process mortgage liabilities
    for (const mortgage of data.liabilities?.mortgage || []) {
      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book, name")
        .eq("plaid_account_id", mortgage.account_id)
        .single();

      if (!account) continue;

      const balance = mortgage.outstanding_principal || 0;
      const apr = mortgage.interest_rate?.percentage || 0;
      const minPayment = mortgage.next_monthly_payment || 0;
      const payoff = calculatePayoff(balance, apr, minPayment);

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor:
            mortgage.servicer_address?.organization || account.name,
          current_balance: balance,
          apr,
          minimum_payment: minPayment,
          statement_due_date:
            mortgage.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
          projected_payoff_months: payoff.months,
          projected_total_interest: payoff.totalInterest,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      );

      synced++;
    }
  }

  // Recalculate payoff projections for ALL debts (including manually-added ones)
  const { data: allDebts } = await adminSupabase.from("debts").select("*");
  for (const debt of allDebts || []) {
    const payoff = calculatePayoff(
      Number(debt.current_balance),
      Number(debt.apr),
      Number(debt.minimum_payment)
    );

    if (
      payoff.months !== debt.projected_payoff_months ||
      Math.abs(payoff.totalInterest - Number(debt.projected_total_interest || 0)) > 0.01
    ) {
      await adminSupabase
        .from("debts")
        .update({
          projected_payoff_months: payoff.months,
          projected_total_interest: payoff.totalInterest,
        })
        .eq("id", debt.id);
    }
  }

  return synced;
}
