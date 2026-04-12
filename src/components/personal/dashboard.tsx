"use client";

import { StatCard } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { AccountsList } from "@/components/personal/accounts-list";
import { TransactionsList } from "@/components/personal/transactions-list";
import { BillsList } from "@/components/personal/bills-list";
import { SubscriptionsList } from "@/components/personal/subscriptions-list";
import { formatCurrency } from "@/lib/format";
import type {
  Account,
  Transaction,
  Bill,
  Subscription,
  Debt,
  Category,
  ProjectedIncome,
} from "@/lib/types";
import { PlaidLinkButton } from "@/components/plaid-link-button";

interface Props {
  accounts: Account[];
  transactions: (Transaction & { categories: { name: string } | null })[];
  bills: Bill[];
  subscriptions: Subscription[];
  debts: Debt[];
  categories: Category[];
  projectedIncome: ProjectedIncome[];
}

export function PersonalDashboard({
  accounts,
  transactions,
  bills,
  subscriptions,
  debts,
  categories,
}: Props) {
  const totalCash = accounts
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + Number(a.current_balance), 0);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStr = monthStart.toISOString().split("T")[0];

  const monthExpenses = transactions
    .filter((t) => !t.is_income && t.date >= monthStr)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const monthIncome = transactions
    .filter((t) => t.is_income && t.date >= monthStr)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const surplus = monthIncome - monthExpenses;

  const totalMonthlySubscriptions = subscriptions
    .filter((s) => s.is_active)
    .reduce((sum, s) => {
      const amt = Number(s.amount);
      switch (s.frequency) {
        case "weekly":
          return sum + amt * 4.33;
        case "quarterly":
          return sum + amt / 3;
        case "yearly":
          return sum + amt / 12;
        default:
          return sum + amt;
      }
    }, 0);

  const totalMonthlyDebt = debts.reduce(
    (sum, d) => sum + Number(d.minimum_payment),
    0
  );

  const upcomingBills = bills.filter((b) => b.status === "upcoming");

  const tabs = [
    { id: "accounts", label: "Accounts", count: accounts.length },
    { id: "transactions", label: "Transactions", count: transactions.length },
    { id: "bills", label: "Bills", count: upcomingBills.length },
    {
      id: "subscriptions",
      label: "Subscriptions",
      count: subscriptions.filter((s) => s.is_active).length,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Personal</h1>
        <PlaidLinkButton />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Current Cash"
          value={formatCurrency(totalCash)}
          color="text-foreground"
        />
        <StatCard
          label="This Month"
          value={formatCurrency(surplus)}
          color={surplus >= 0 ? "text-surplus" : "text-deficit"}
          subtext={surplus >= 0 ? "surplus" : "deficit"}
        />
        <StatCard
          label="Monthly Subscriptions"
          value={formatCurrency(totalMonthlySubscriptions)}
          color="text-warning"
        />
        <StatCard
          label="Monthly Debt Payments"
          value={formatCurrency(totalMonthlyDebt)}
          color="text-deficit"
        />
        <StatCard
          label="Upcoming Bills"
          value={String(upcomingBills.length)}
          subtext="due this month"
        />
      </div>

      {/* Tabbed content */}
      <Tabs tabs={tabs} defaultTab="accounts">
        {(activeTab) => (
          <>
            {activeTab === "accounts" && (
              <AccountsList accounts={accounts} />
            )}
            {activeTab === "transactions" && (
              <TransactionsList
                transactions={transactions}
                categories={categories}
              />
            )}
            {activeTab === "bills" && <BillsList bills={bills} />}
            {activeTab === "subscriptions" && (
              <SubscriptionsList subscriptions={subscriptions} />
            )}
          </>
        )}
      </Tabs>
    </div>
  );
}
