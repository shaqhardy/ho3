"use client";

import Link from "next/link";
import { Card, ElevatedCard, StatCard } from "@/components/ui/card";
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
  Beaker,
} from "lucide-react";
import { EmptyState, EmptyStateBanner } from "@/components/empty-state";
import { PlaidLinkButton } from "@/components/plaid-link-button";
import { BOOK_LABELS } from "@/lib/books";
import { NetWorthTrend } from "@/components/charts/net-worth-trend";
import { CategoryDonut } from "@/components/charts/category-donut";
import {
  netWorth as computeNetWorth,
  totalAssets as computeTotalAssets,
  totalLiabilities as computeTotalLiabilities,
  signedNetWorthBalance,
} from "@/lib/accounts/money";

type BookAccent = "terracotta" | "blue" | "green";

const bookConfig: Record<
  Book,
  {
    label: string;
    icon: typeof Wallet;
    href: string;
    accent: BookAccent;
    accentBg: string;
    accentText: string;
  }
> = {
  personal: {
    label: BOOK_LABELS.personal,
    icon: Wallet,
    href: "/personal",
    accent: "terracotta",
    accentBg: "bg-terracotta/10",
    accentText: "text-terracotta",
  },
  business: {
    label: BOOK_LABELS.business,
    icon: Building2,
    href: "/business",
    accent: "blue",
    accentBg: "bg-accent-blue/10",
    accentText: "text-accent-blue",
  },
  nonprofit: {
    label: BOOK_LABELS.nonprofit,
    icon: Heart,
    href: "/nonprofit",
    accent: "green",
    accentBg: "bg-accent-green/10",
    accentText: "text-accent-green",
  },
};

export interface OverviewTrendsTxn {
  id: string;
  book: Book;
  date: string;
  amount: number | string;
  is_income: boolean;
  account_id: string | null;
  split_parent_id: string | null;
}

interface Props {
  accounts: Account[];
  bills: Bill[];
  subscriptions: Subscription[];
  debts: Debt[];
  recentTransactions: Transaction[];
  trendsTxns?: OverviewTrendsTxn[];
}

export function OverviewDashboard({
  accounts,
  bills,
  subscriptions,
  debts,
  recentTransactions,
  trendsTxns = [],
}: Props) {
  // Fully empty state: no accounts and no transactions (owned by Agent E)
  if (accounts.length === 0 && recentTransactions.length === 0) {
    return (
      <div className="has-bottom-nav space-y-6">
        <header>
          <p className="label-sm">Dashboard</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Overview
          </h1>
        </header>
        <EmptyState
          title="Welcome to HO3"
          description="Three books, one clear picture. Connect your first bank to see your net worth, upcoming bills, and where your money is going."
        >
          <div className="flex flex-col items-center gap-3">
            <PlaidLinkButton label="Connect your first account" />
            <p className="text-xs text-muted max-w-md text-center">
              Pick the book these accounts belong to on the next step —
              Personal, Shaq Hardy LLC, or Orphan No More.
            </p>
          </div>
          <div>
            <p className="label-sm mb-3">Preview</p>
            <div
              aria-hidden="true"
              className="grid grid-cols-1 gap-3 sm:grid-cols-3 opacity-50 pointer-events-none select-none"
            >
              {[
                { label: BOOK_LABELS.personal, value: "$12,480", icon: Wallet },
                { label: BOOK_LABELS.business, value: "$48,120", icon: Building2 },
                { label: BOOK_LABELS.nonprofit, value: "$6,340", icon: Heart },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="relative rounded-xl border border-dashed border-border bg-card p-5"
                  >
                    <span className="absolute -top-2 right-3 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                      Preview
                    </span>
                    <div className="flex items-center gap-2 text-muted">
                      <Icon className="h-4 w-4 text-terracotta" />
                      <span className="text-xs">{item.label}</span>
                    </div>
                    <p className="mt-2 text-xl font-bold num text-foreground/80">
                      {item.value}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      +$320 this month
                    </p>
                  </div>
                );
              })}
            </div>

            <ul className="mt-8 space-y-2 text-sm text-muted text-left mx-auto max-w-md">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-terracotta shrink-0" />
                <span>Track bills across Personal, Business, and Nonprofit</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-terracotta shrink-0" />
                <span>Project your cash runway</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-terracotta shrink-0" />
                <span>Plan debt payoff</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-terracotta shrink-0" />
                <span>OCR receipts</span>
              </li>
            </ul>
          </div>
        </EmptyState>
      </div>
    );
  }

  // Partial empty: accounts connected but no transactions synced yet (owned by Agent E)
  const sparseBanner =
    accounts.length > 0 && recentTransactions.length === 0 ? (
      <EmptyStateBanner
        title="Your accounts are connected."
        description="Transactions usually sync within a few minutes."
      />
    ) : null;

  // Net worth by book = assets − liabilities, per book.
  // Credit/loan accounts contribute negatively; depository/investment contribute positively.
  const bookBalances: Record<Book, number> = {
    personal: 0,
    business: 0,
    nonprofit: 0,
  };
  for (const a of accounts) {
    bookBalances[a.book] += signedNetWorthBalance(a);
  }

  // Hero "owed" uses the accounts table — authoritative for what reduces net worth.
  const accountLiabilities = computeTotalLiabilities(accounts);
  // Debt Summary section uses the debts table — it has APR / minimum payment detail.
  const debtsTableTotal = debts.reduce(
    (sum, d) => sum + Number(d.current_balance),
    0
  );
  const netWorth = computeNetWorth(accounts);

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

  const totalAssets = computeTotalAssets(accounts);

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
    <div className="has-bottom-nav space-y-8">
      {/* Page header */}
      <header className="flex items-end justify-between">
        <div>
          <p className="label-sm">Dashboard</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Overview
          </h1>
        </div>
      </header>

      {sparseBanner}

      {/* What If quick-link (cross-book) */}
      <section>
        <Link href="/overview/whatif" className="group block">
          <Card
            interactive
            accent="terracotta"
            className="flex items-center gap-4"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-terracotta/15">
              <Beaker className="h-5 w-5 text-terracotta" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Cross-book What If
              </p>
              <p className="text-xs text-muted">
                Model hypothetical moves across Personal, Business, and
                Nonprofit in one view.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Card>
        </Link>
      </section>

      {/* Hero net worth */}
      <ElevatedCard>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label-sm">Net Worth</p>
            <p
              className={`mt-2 hero-value ${netWorth >= 0 ? "text-foreground" : "text-deficit"}`}
            >
              {formatCurrency(netWorth)}
            </p>
            <p className="mt-2 text-xs text-muted num">
              <span className="text-surplus">
                {formatCurrency(totalAssets)}
              </span>{" "}
              assets
              {accountLiabilities > 0 && (
                <>
                  {" · "}
                  <span className="text-deficit">
                    {formatCurrency(accountLiabilities)}
                  </span>{" "}
                  owed
                </>
              )}
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-4 sm:gap-8">
            {(["personal", "business", "nonprofit"] as Book[]).map((book) => (
              <div key={book} className="text-left sm:text-right">
                <dt className="label-sm">{bookConfig[book].label}</dt>
                <dd className="mt-1 text-base font-semibold num text-foreground sm:text-lg">
                  {formatCurrency(bookBalances[book])}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </ElevatedCard>

      {/* Per-book stat row */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-sm">Books · This Month</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["personal", "business", "nonprofit"] as Book[]).map((book) => {
            const surplus = bookSurplus[book];
            const valueColor =
              surplus > 0
                ? "text-surplus"
                : surplus < 0
                  ? "text-deficit"
                  : "text-foreground";
            return (
              <StatCard
                key={book}
                label={bookConfig[book].label}
                value={formatCurrency(bookBalances[book])}
                subtext={
                  surplus !== 0
                    ? `${surplus >= 0 ? "+" : ""}${formatCurrency(surplus)} this month`
                    : "no change this month"
                }
                color={valueColor}
                accent={bookConfig[book].accent}
              />
            );
          })}
        </div>
      </section>

      {/* Book quick links */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-sm">Jump to Book</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["personal", "business", "nonprofit"] as Book[]).map((book) => {
            const config = bookConfig[book];
            const Icon = config.icon;
            const bookAccounts = accounts.filter((a) => a.book === book);

            return (
              <Link key={book} href={config.href} className="group">
                <Card
                  interactive
                  accent={config.accent}
                  className="flex items-center gap-4"
                >
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${config.accentBg}`}
                  >
                    <Icon className={`h-5 w-5 ${config.accentText}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {config.label}
                    </p>
                    <p className="text-xs text-muted num">
                      {bookAccounts.length} account
                      {bookAccounts.length !== 1 ? "s" : ""} ·{" "}
                      {formatCurrency(bookBalances[book])}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Cross-book charts */}
      {trendsTxns.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-sm">Insights</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <NetWorthTrend
                accounts={accounts as Parameters<typeof NetWorthTrend>[0]["accounts"]}
                transactions={trendsTxns as Parameters<typeof NetWorthTrend>[0]["transactions"]}
                months={12}
              />
            </Card>
            <Card>
              <CategoryDonut
                transactions={(trendsTxns.map((t) => ({
                  ...t,
                  categories: null,
                })) as unknown) as Parameters<typeof CategoryDonut>[0]["transactions"]}
              />
            </Card>
          </div>
        </section>
      )}

      {/* Upcoming in next 14 days */}
      {upcoming14.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-sm">Upcoming · Next 14 Days</h2>
            <span className="text-xs text-muted num">
              {upcoming14.length} item{upcoming14.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="card-depth overflow-hidden rounded-xl border border-border-subtle bg-card">
            <ul className="divide-y divide-border-subtle">
              {upcoming14.map((item) => (
                <li
                  key={`${item.type}-${item.id}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-background/40 text-muted">
                    {item.type === "bill" ? (
                      <Calendar className="h-4 w-4" />
                    ) : (
                      <RotateCw className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.name}
                    </p>
                    <p className="text-xs text-muted">
                      {formatRelativeDate(item.date)} ·{" "}
                      <span className="capitalize">{item.book}</span>
                    </p>
                  </div>
                  <p className="text-sm font-semibold num text-foreground">
                    {formatCurrency(item.amount)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Debt summary */}
      {debtsTableTotal > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-sm">Debt Summary</h2>
            <Link
              href="/personal/debts"
              className="text-xs font-medium text-terracotta hover:underline"
            >
              Manage &rarr;
            </Link>
          </div>
          <Card accent="deficit">
            <div className="flex items-center justify-between">
              <p className="label-sm">Total Debt</p>
              <p className="display-value text-deficit">
                {formatCurrency(debtsTableTotal)}
              </p>
            </div>
            <ul className="mt-4 space-y-1.5">
              {debts.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-muted">{d.creditor}</span>
                  <span className="num text-foreground">
                    {formatCurrency(Number(d.current_balance))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
