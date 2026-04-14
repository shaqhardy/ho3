"use client";

import { Card, ElevatedCard, StatCard } from "@/components/ui/card";
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
import { EmptyState } from "@/components/empty-state";
import Link from "next/link";
import { Beaker } from "lucide-react";

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
  // Empty state: no accounts connected yet (owned by Agent E)
  if (accounts.length === 0) {
    return (
      <div className="has-bottom-nav space-y-6">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="label-sm">Book</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Personal
            </h1>
          </div>
          <PlaidLinkButton />
        </header>

        <EmptyState
          title="Get started with your Personal book"
          description="Connect a bank account to see transactions, categorize spending, track bills, and watch your plan update daily."
        >
          <ul className="space-y-2 text-sm text-muted text-left mx-auto max-w-md">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-terracotta shrink-0" />
              <span>See every transaction and assign it to a category</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-terracotta shrink-0" />
              <span>Track upcoming bills and recurring subscriptions</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-terracotta shrink-0" />
              <span>Get a daily-updated plan for surplus, deficit, and debt payoff</span>
            </li>
          </ul>
        </EmptyState>
      </div>
    );
  }

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

  // Monthly fixed bills — approximate all non-cancelled/paused bills to their
  // monthly cadence so the KPI reflects the committed obligation, not just
  // what happens to be due this calendar month.
  const totalMonthlyBills = bills
    .filter((b) => {
      const lc = (b as Bill & { lifecycle?: string }).lifecycle;
      return !lc || lc === "active";
    })
    .reduce((sum, b) => {
      const bx = b as Bill & {
        variable?: boolean;
        typical_amount?: number | string | null;
      };
      const base = Number(
        bx.variable ? bx.typical_amount ?? 0 : b.amount ?? 0
      );
      if (!base) return sum;
      switch (b.frequency) {
        case "weekly":
          return sum + base * 4.33;
        case "quarterly":
          return sum + base / 3;
        case "yearly":
          return sum + base / 12;
        default:
          return sum + base;
      }
    }, 0);

  const upcomingBills = bills.filter((b) => b.status === "upcoming");

  const totalDebt = debts.reduce(
    (sum, d) => sum + Number(d.current_balance),
    0
  );

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
    <div className="has-bottom-nav space-y-8">
      {/* Page header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="label-sm">Book</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Personal
          </h1>
        </div>
        <PlaidLinkButton />
      </header>

      {/* Hero cash card */}
      <ElevatedCard accent="terracotta">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label-sm">Current Cash</p>
            <p className="mt-2 hero-value text-foreground">
              {formatCurrency(totalCash)}
            </p>
          </div>
          <div className="flex flex-col items-start sm:items-end">
            <p className="label-sm">This Month</p>
            <p
              className={`mt-2 display-value ${surplus >= 0 ? "text-surplus" : "text-deficit"}`}
            >
              {surplus >= 0 ? "+" : ""}
              {formatCurrency(surplus)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {surplus >= 0 ? "surplus" : "deficit"}
            </p>
          </div>
        </div>
      </ElevatedCard>

      {/* Stat row */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-sm">Monthly Commitments</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Monthly Bills"
            value={formatCurrency(totalMonthlyBills)}
            subtext={`${upcomingBills.length} upcoming`}
            color="text-foreground"
            accent="terracotta"
          />
          <StatCard
            label="Subscriptions"
            value={formatCurrency(totalMonthlySubscriptions)}
            color="text-warning"
            accent="warning"
          />
          <StatCard
            label="Debt Payments"
            value={formatCurrency(totalMonthlyDebt)}
            color="text-deficit"
            accent="deficit"
          />
          <StatCard
            label="Upcoming Bills"
            value={String(upcomingBills.length)}
            subtext="due this month"
          />
        </div>
      </section>

      {/* Quick links */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-sm">Quick Actions</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/personal/debts" className="group">
            <Card
              interactive
              accent="deficit"
              className="flex items-center justify-between"
            >
              <div>
                <p className="label-sm">Debts</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  Track payoff
                </p>
              </div>
              <p className="text-base font-bold num text-deficit">
                {formatCurrency(totalDebt)}
              </p>
            </Card>
          </Link>
          <Link href="/personal/plan" className="group">
            <Card
              interactive
              accent="terracotta"
              className="flex items-center justify-between"
            >
              <div>
                <p className="label-sm">The Plan</p>
                <p className="mt-1 text-sm font-semibold text-terracotta">
                  View &rarr;
                </p>
              </div>
              <div className="h-8 w-8 rounded-lg bg-terracotta/15" />
            </Card>
          </Link>
          <Link href="/personal/catchup" className="group">
            <Card
              interactive
              accent="surplus"
              className="flex items-center justify-between"
            >
              <div>
                <p className="label-sm">Catch-Up</p>
                <p className="mt-1 text-sm font-semibold text-surplus">
                  Mode &rarr;
                </p>
              </div>
              <div className="h-8 w-8 rounded-lg bg-surplus/15" />
            </Card>
          </Link>
          <Link href="/personal/whatif" className="group">
            <Card
              interactive
              accent="terracotta"
              className="flex items-center justify-between"
            >
              <div>
                <p className="label-sm">What If</p>
                <p className="mt-1 text-sm font-semibold text-terracotta">
                  Run scenarios &rarr;
                </p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terracotta/15">
                <Beaker className="h-4 w-4 text-terracotta" />
              </div>
            </Card>
          </Link>
        </div>
      </section>

      {/* Tabbed content */}
      <section>
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
      </section>
    </div>
  );
}
