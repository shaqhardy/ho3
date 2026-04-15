import type { PushPayload } from "@/lib/push/send";

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtUsdShort(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// ---- Large transaction ------------------------------------------------------
export function buildLargeTxnPush(
  txn: {
    id: string;
    amount: number;
    merchant?: string | null;
    description?: string | null;
    book?: string | null;
    date?: string | null;
  },
  account: { id?: string | null; name?: string | null } | null,
  category: { name?: string | null } | null
): PushPayload {
  const merchant = txn.merchant || txn.description || "Unknown merchant";
  const who = category?.name ? ` (${category.name})` : "";
  const where = account?.name ? ` on ${account.name}` : "";
  return {
    title: `Large charge: ${fmtUsd(txn.amount)}`,
    body: `${merchant}${who}${where}`,
    url: "/transactions",
    tag: `large-txn-${txn.id}`,
    data: {
      kind: "large_txn",
      transaction_id: txn.id,
      amount: txn.amount,
      book: txn.book ?? null,
    },
  };
}

// ---- Income -----------------------------------------------------------------
export function buildIncomePush(
  txn: {
    id: string;
    amount: number;
    merchant?: string | null;
    description?: string | null;
    book?: string | null;
  },
  account: { name?: string | null } | null
): PushPayload {
  const source = txn.merchant || txn.description || "an unknown source";
  const where = account?.name ? ` (${account.name})` : "";
  return {
    title: `💰 Income received`,
    body: `${fmtUsd(txn.amount)} from ${source}${where} hit your account`,
    url: "/transactions",
    tag: `income-${txn.id}`,
    data: {
      kind: "income",
      transaction_id: txn.id,
      amount: txn.amount,
      book: txn.book ?? null,
    },
  };
}

// ---- Low balance ------------------------------------------------------------
export function buildLowBalancePush(account: {
  id: string;
  name?: string | null;
  current_balance?: number | null;
  available_balance?: number | null;
  low_balance_threshold?: number | null;
}): PushPayload {
  const balance = Number(account.available_balance ?? account.current_balance ?? 0);
  const threshold = Number(account.low_balance_threshold ?? 0);
  return {
    title: `Low balance: ${account.name ?? "Account"}`,
    body: `Balance is ${fmtUsd(balance)} — below your ${fmtUsd(threshold)} threshold.`,
    url: "/overview",
    tag: `low-balance-${account.id}`,
    data: {
      kind: "low_balance",
      account_id: account.id,
      balance,
      threshold,
    },
  };
}

// ---- Bill paid --------------------------------------------------------------
export function buildBillPaidPush(
  bill: { id: string; name: string; amount: number; book?: string | null },
  txn: { id: string; merchant?: string | null } | null,
  accountBalance: number | null
): PushPayload {
  const balanceLine =
    accountBalance !== null && !Number.isNaN(accountBalance)
      ? ` · new balance ${fmtUsd(accountBalance)}`
      : "";
  return {
    title: `Bill paid: ${bill.name}`,
    body: `${fmtUsd(Number(bill.amount))} posted${balanceLine}`,
    url: "/plan",
    tag: `bill-paid-${bill.id}`,
    data: {
      kind: "bill_paid",
      bill_id: bill.id,
      transaction_id: txn?.id ?? null,
      account_balance: accountBalance,
    },
  };
}

// ---- Bill NOT paid ----------------------------------------------------------
export function buildBillNotPaidPush(bill: {
  id: string;
  name: string;
  amount: number;
  due_date: string;
  book?: string | null;
}): PushPayload {
  return {
    title: `⚠ Bill NOT paid: ${bill.name}`,
    body: `${fmtUsd(Number(bill.amount))} was due ${bill.due_date} — no matching charge found.`,
    url: "/plan",
    tag: `bill-not-paid-${bill.id}`,
    data: {
      kind: "bill_not_paid",
      bill_id: bill.id,
      due_date: bill.due_date,
    },
  };
}

// ---- Subscription renewal ---------------------------------------------------
export function buildSubscriptionRenewalPush(
  subs: { id: string; name: string; amount: number; next_charge_date: string }[],
  daysAhead: number
): PushPayload {
  if (subs.length === 0) {
    return {
      title: "Subscription renewals",
      body: "No renewals.",
      url: "/plan",
      tag: "sub-renewal",
    };
  }
  const total = subs.reduce((s, x) => s + Number(x.amount), 0);
  const when =
    daysAhead === 1 ? "tomorrow" : daysAhead === 0 ? "today" : `in ${daysAhead} days`;
  if (subs.length === 1) {
    const only = subs[0];
    return {
      title: `Renewal ${when}: ${only.name}`,
      body: `${fmtUsd(Number(only.amount))} charges on ${only.next_charge_date}.`,
      url: "/plan",
      tag: `sub-renewal-${only.id}`,
      data: {
        kind: "subscription_renewal",
        subscription_ids: [only.id],
        total,
      },
    };
  }
  return {
    title: `${subs.length} subscriptions renewing`,
    body: `Total ${fmtUsd(total)} charging in the next ${daysAhead} day${
      daysAhead === 1 ? "" : "s"
    }.`,
    url: "/plan",
    tag: "sub-renewal-group",
    data: {
      kind: "subscription_renewal",
      subscription_ids: subs.map((s) => s.id),
      total,
    },
  };
}

// ---- Debt milestone ---------------------------------------------------------
export function buildDebtMilestonePush(
  debt: {
    id: string;
    creditor: string;
    nickname?: string | null;
    original_balance?: number | null;
    custom_milestone_threshold?: number | null;
  },
  milestone: "paid_off" | "halfway" | "custom",
  balance: number
): PushPayload {
  const name = debt.nickname || debt.creditor;
  if (milestone === "paid_off") {
    return {
      title: `🎉 Debt paid off: ${name}`,
      body: `You crushed it — ${name} is at $0.`,
      url: "/debts",
      tag: `debt-paidoff-${debt.id}`,
      data: { kind: "debt_paid_off", debt_id: debt.id, balance },
    };
  }
  if (milestone === "halfway") {
    return {
      title: `Halfway there: ${name}`,
      body: `Balance is ${fmtUsd(balance)} — half of your starting balance paid down.`,
      url: "/debts",
      tag: `debt-halfway-${debt.id}`,
      data: { kind: "debt_halfway", debt_id: debt.id, balance },
    };
  }
  return {
    title: `Milestone hit: ${name}`,
    body: `Balance is ${fmtUsd(balance)} — reached your custom target of ${fmtUsd(
      Number(debt.custom_milestone_threshold ?? 0)
    )}.`,
    url: "/debts",
    tag: `debt-custom-${debt.id}`,
    data: { kind: "debt_custom_milestone", debt_id: debt.id, balance },
  };
}

// ---- Plaid reconnect --------------------------------------------------------
export function buildPlaidReconnectPush(institution: {
  id: string;
  plaid_item_id?: string | null;
  institution_name?: string | null;
}): PushPayload {
  const name = institution.institution_name || "a bank connection";
  return {
    title: `Reconnect needed: ${name}`,
    body: `Sign back in so HO3 can keep syncing transactions.`,
    url: "/settings",
    tag: `plaid-reconnect-${institution.id}`,
    data: {
      kind: "plaid_reconnect",
      plaid_item_id: institution.plaid_item_id ?? institution.id,
    },
  };
}

// ---- Category overspend -----------------------------------------------------
export function buildCategoryOverspendPush(
  category: { id: string; name: string },
  budget: { id: string; name?: string | null; period_start_date?: string | null },
  spent: number,
  allocated: number
): PushPayload {
  const over = spent - allocated;
  return {
    title: `Over budget: ${category.name}`,
    body: `${fmtUsd(spent)} spent of ${fmtUsd(allocated)} — ${fmtUsdShort(over)} over.`,
    url: "/plan",
    tag: `overspend-${category.id}-${budget.id}`,
    data: {
      kind: "category_overspend",
      category_id: category.id,
      budget_id: budget.id,
      spent,
      allocated,
      over,
    },
  };
}

// ---- Statement available ----------------------------------------------------
export function buildStatementAvailablePush(args: {
  account_id: string;
  account_name?: string | null;
  period_end: string;
}): PushPayload {
  const label = args.account_name || "an account";
  return {
    title: `New statement: ${label}`,
    body: `Statement period ending ${args.period_end} is available.`,
    url: `/accounts/${args.account_id}`,
    tag: `statement-${args.account_id}-${args.period_end}`,
    data: {
      kind: "statement_available",
      account_id: args.account_id,
      period_end: args.period_end,
    },
  };
}

// ---- Goal hit ---------------------------------------------------------------
export function buildGoalHitPush(goal: {
  id: string;
  name: string;
  target_amount: number;
  current_amount?: number | null;
}): PushPayload {
  return {
    title: `🎯 Goal hit: ${goal.name}`,
    body: `You reached your target of ${fmtUsd(Number(goal.target_amount))}.`,
    url: "/goals",
    tag: `goal-hit-${goal.id}`,
    data: {
      kind: "goal_hit",
      goal_id: goal.id,
      target_amount: Number(goal.target_amount),
      current_amount: goal.current_amount ?? null,
    },
  };
}
