"use client";

import Link from "next/link";
import { Card, StatCard } from "@/components/ui/card";
import {
  formatCurrency,
  formatRelativeDate,
  daysUntil,
} from "@/lib/format";
import type {
  Account,
  Bill,
  Subscription,
  Debt,
  Transaction,
  Book,
} from "@/lib/types";
import {
  Wallet,
  Building2,
  Heart,
  ArrowRight,
  Calendar,
  RotateCw,
} from "lucide-react";

const bookConfig: Record<Book, { label: string; icon: typeof Wallet; href: string }> = {
  personal: { label: "Personal", icon: Wallet, href: "/personal" },
  business: { label: "Business", icon: Building2, href: "/business" },
  nonprofit: { label: "Nonprofit", icon: Heart, href: "/nonprofit" },
};

interface Props {
  accounts: Account[];
  bills: Bill[];
  subscriptions: Subscription[];
  debts: Debt[];
  recentTransactions: Transaction[];
}

export function OverviewDashboard({
  accounts,
  bills,
  subscriptions,
  debts,
  recentTransactions,
}: Props) {
  // Net worth by book
  const bookBalances: Record<Book, number> = {
    personal: 0,
    business: 0,
    nonprofit: 0,
  };
  for (const a of accounts) {
    bookBalances[a.book] += Number(a.current_balance);
  }

  const totalDebt = debts.reduce(
    (sum, d) => sum + Number(d.current_balance),
    0
  );
  const netWorth =
    bookBalances.personal +
    bookBalances.business +
    bookBalances.nonprofit -
    totalDebt;

  // This month surplus/deficit per book
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStr = monthStart.toISOString().split("T")[0];

  const bookSurplus: Record<Book, number> = {
    personal: 0,
    business: 0,
    nonprofit: 0,
  };
  for (const t of recentTransactions) {
    if (t.date >= monthStr) {
      if (t.is_income) {
        bookSurplus[t.book] += Number(t.amount);
      } else {
        bookSurplus[t.book] -= Number(t.amount);
      }
    }
  }

  // Upcoming bills + subs in next 14 days
  const upcoming14 = [
    ...bills
      .filter((b) => daysUntil(b.due_date) >= 0 && daysUntil(b.due_date) <= 14)
      .map((b) => ({
        id: b.id,
        type: "bill" as const,
        name: b.name,
        amount: Number(b.amount),
        date: b.due_date,
        book: b.book,
      })),
    ...subscriptions
      .filter(
        (s) =>
          daysUntil(s.next_charge_date) >= 0 &&
          daysUntil(s.next_charge_date) <= 14
      )
      .map((s) => ({
        id: s.id,
        type: "subscription" as const,
        name: s.name,
        amount: Number(s.amount),
        date: s.next_charge_date,
        book: s.book,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Overview</h1>

      {/* Net worth */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Net Worth"
          value={formatCurrency(netWorth)}
          color={netWorth >= 0 ? "text-surplus" : "text-deficit"}
        />
        {(["personal", "business", "nonprofit"] as Book[]).map((book) => (
          <StatCard
            key={book}
            label={bookConfig[book].label}
            value={formatCurrency(bookBalances[book])}
            subtext={
              bookSurplus[book] !== 0
                ? `${bookSurplus[book] >= 0 ? "+" : ""}${formatCurrency(bookSurplus[book])} this month`
                : undefined
            }
            color={
              bookSurplus[book] > 0
                ? "text-surplus"
                : bookSurplus[book] < 0
                  ? "text-deficit"
                  : "text-foreground"
            }
          />
        ))}
      </div>

      {/* Book quick links */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(["personal", "business", "nonprofit"] as Book[]).map((book) => {
          const config = bookConfig[book];
          const Icon = config.icon;
          const bookAccounts = accounts.filter((a) => a.book === book);

          return (
            <Link key={book} href={config.href}>
              <Card className="flex items-center gap-3 hover:bg-card-hover transition-colors cursor-pointer">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-terracotta/10">
                  <Icon className="h-5 w-5 text-terracotta" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {config.label}
                  </p>
                  <p className="text-xs text-muted">
                    {bookAccounts.length} account
                    {bookAccounts.length !== 1 ? "s" : ""} ·{" "}
                    {formatCurrency(bookBalances[book])}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted" />
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Upcoming in next 14 days */}
      {upcoming14.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Upcoming (Next 14 Days)
          </h2>
          <div className="space-y-2">
            {upcoming14.map((item) => (
              <Card
                key={`${item.type}-${item.id}`}
                className="flex items-center gap-3 py-3 px-4"
              >
                {item.type === "bill" ? (
                  <Calendar className="h-4 w-4 text-muted" />
                ) : (
                  <RotateCw className="h-4 w-4 text-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">
                    {item.name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatRelativeDate(item.date)} ·{" "}
                    <span className="capitalize">{item.book}</span>
                  </p>
                </div>
                <p className="text-sm font-semibold text-foreground">
                  {formatCurrency(item.amount)}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Debt summary */}
      {totalDebt > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Debt Summary
            </h2>
            <Link
              href="/personal/debts"
              className="text-xs text-terracotta hover:underline"
            >
              Manage &rarr;
            </Link>
          </div>
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">Total Debt</p>
              <p className="text-lg font-bold text-deficit">
                {formatCurrency(totalDebt)}
              </p>
            </div>
            <div className="mt-2 space-y-1">
              {debts.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-muted">{d.creditor}</span>
                  <span className="text-foreground">
                    {formatCurrency(Number(d.current_balance))}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
