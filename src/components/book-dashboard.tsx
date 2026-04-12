"use client";

import { useState } from "react";
import { Card, ElevatedCard, StatCard } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { formatCurrency, formatDate, formatRelativeDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Account, Transaction, Subscription, Category, Book } from "@/lib/types";
import { AccountsList } from "@/components/personal/accounts-list";
import { EmptyState } from "@/components/empty-state";
import { Plus, RotateCw, Pause, Beaker } from "lucide-react";
import Link from "next/link";

interface Props {
  book: Book;
  bookLabel: string;
  accounts: Account[];
  transactions: (Transaction & { categories: { name: string } | null })[];
  subscriptions: Subscription[];
  categories: Category[];
}

export function BookDashboard({
  book,
  bookLabel,
  accounts,
  transactions,
  subscriptions,
  categories,
}: Props) {
  const [showSubForm, setShowSubForm] = useState(false);
  const router = useRouter();

  // Empty state: no accounts assigned to this book yet
  if (accounts.length === 0) {
    const description =
      book === "business"
        ? "Connect your business accounts to monitor expenses, track Owner Pay, and see upcoming subscription charges."
        : book === "nonprofit"
          ? "Connect your nonprofit accounts to track program expenses, donations received, and subscription renewals."
          : "Connect accounts to start tracking this book.";

    return (
      <div className="has-bottom-nav space-y-6">
        <header>
          <p className="label-sm">Book</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {bookLabel}
          </h1>
        </header>
        <EmptyState
          title={`Start tracking ${bookLabel}`}
          description={description}
          cta={{ label: "Connect an account", href: "/personal" }}
        >
          <p className="text-sm text-muted max-w-lg mx-auto leading-relaxed">
            Accounts are connected from the Personal page and can be reassigned
            to this book from the admin panel.
          </p>
        </EmptyState>
      </div>
    );
  }

  const totalBalance = accounts.reduce(
    (sum, a) => sum + Number(a.current_balance),
    0
  );

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStr = monthStart.toISOString().split("T")[0];

  const monthExpenses = transactions
    .filter((t) => !t.is_income && t.date >= monthStr)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalMonthlySubs = subscriptions
    .filter((s) => s.is_active)
    .reduce((sum, s) => {
      const amt = Number(s.amount);
      if (s.frequency === "yearly") return sum + amt / 12;
      if (s.frequency === "quarterly") return sum + amt / 3;
      if (s.frequency === "weekly") return sum + amt * 4.33;
      return sum + amt;
    }, 0);

  const upcomingSubs = subscriptions
    .filter((s) => s.is_active)
    .sort(
      (a, b) =>
        new Date(a.next_charge_date).getTime() -
        new Date(b.next_charge_date).getTime()
    );

  // Group expenses by category
  const expensesByCategory = transactions
    .filter((t) => !t.is_income && t.date >= monthStr)
    .reduce(
      (acc, t) => {
        const cat = t.categories?.name || "Other";
        acc[cat] = (acc[cat] || 0) + Number(t.amount);
        return acc;
      },
      {} as Record<string, number>
    );

  async function addSubscription(formData: FormData) {
    const supabase = createClient();
    await supabase.from("subscriptions").insert({
      book,
      name: formData.get("name") as string,
      amount: parseFloat(formData.get("amount") as string),
      next_charge_date: formData.get("next_charge_date") as string,
      frequency: formData.get("frequency") as string,
      is_active: true,
    });
    setShowSubForm(false);
    router.refresh();
  }

  async function toggleSub(id: string, active: boolean) {
    const supabase = createClient();
    await supabase
      .from("subscriptions")
      .update({ is_active: !active })
      .eq("id", id);
    router.refresh();
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "accounts", label: "Accounts", count: accounts.length },
    { id: "expenses", label: "Expenses" },
    { id: "subscriptions", label: "Subscriptions", count: upcomingSubs.length },
  ];

  const bookAccent: "blue" | "green" | "terracotta" =
    book === "business" ? "blue" : book === "nonprofit" ? "green" : "terracotta";

  return (
    <div className="has-bottom-nav space-y-8">
      <header>
        <p className="label-sm">Book</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {bookLabel}
        </h1>
      </header>

      <section>
        <div className="mb-3">
          <h2 className="label-sm">Quick Actions</h2>
        </div>
        <Link href={`/${book}/whatif`} className="group block">
          <Card
            interactive
            accent="terracotta"
            className="flex items-center gap-4"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-terracotta/15">
              <Beaker className="h-5 w-5 text-terracotta" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">What If</p>
              <p className="text-xs text-muted">
                Try hypothetical expenses &amp; income without changing your
                books.
              </p>
            </div>
            <p className="hidden sm:block text-xs font-medium text-terracotta">
              Run scenarios &rarr;
            </p>
          </Card>
        </Link>
      </section>

      <Tabs tabs={tabs} defaultTab="overview">
        {(tab) => (
          <>
            {tab === "overview" && (
              <div className="space-y-8">
                <ElevatedCard accent={bookAccent}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="label-sm">Total Balance</p>
                      <p className="mt-2 hero-value text-foreground">
                        {formatCurrency(totalBalance)}
                      </p>
                    </div>
                    <div className="flex flex-col items-start sm:items-end">
                      <p className="label-sm">This Month&apos;s Expenses</p>
                      <p className="mt-2 display-value text-deficit">
                        {formatCurrency(monthExpenses)}
                      </p>
                    </div>
                  </div>
                </ElevatedCard>

                <div>
                  <div className="mb-3">
                    <h2 className="label-sm">Monthly Commitments</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                    <StatCard
                      label="Monthly Subscriptions"
                      value={formatCurrency(totalMonthlySubs)}
                      color="text-warning"
                      accent="warning"
                    />
                    <StatCard
                      label="Active Subs"
                      value={String(upcomingSubs.length)}
                      subtext="recurring"
                    />
                  </div>
                </div>

                {/* Upcoming subscriptions */}
                {upcomingSubs.length > 0 && (
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="label-sm">Upcoming Charges</h3>
                      <span className="text-xs text-muted num">
                        {upcomingSubs.length} active
                      </span>
                    </div>
                    <div className="card-depth overflow-hidden rounded-xl border border-border-subtle bg-card">
                      <ul className="divide-y divide-border-subtle">
                        {upcomingSubs.slice(0, 5).map((sub) => (
                          <li
                            key={sub.id}
                            className="flex items-center justify-between gap-3 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {sub.name}
                              </p>
                              <p className="text-xs text-muted">
                                {formatRelativeDate(sub.next_charge_date)}
                              </p>
                            </div>
                            <p className="text-sm font-semibold num text-foreground">
                              {formatCurrency(Number(sub.amount))}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Expenses by category */}
                {Object.keys(expensesByCategory).length > 0 && (
                  <div>
                    <div className="mb-3">
                      <h3 className="label-sm">Expenses by Category</h3>
                    </div>
                    <div className="card-depth overflow-hidden rounded-xl border border-border-subtle bg-card">
                      <ul className="divide-y divide-border-subtle">
                        {Object.entries(expensesByCategory)
                          .sort(([, a], [, b]) => b - a)
                          .map(([cat, amount]) => (
                            <li
                              key={cat}
                              className="flex items-center justify-between px-4 py-2.5"
                            >
                              <span className="text-sm text-foreground">
                                {cat}
                              </span>
                              <span className="text-sm font-medium num text-foreground">
                                {formatCurrency(amount)}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "accounts" && <AccountsList accounts={accounts} />}

            {tab === "expenses" && (
              <div className="space-y-2">
                {transactions.length === 0 ? (
                  <Card className="text-center py-12">
                    <p className="text-muted">No transactions yet.</p>
                  </Card>
                ) : (
                  transactions.slice(0, 50).map((txn) => (
                    <Card
                      key={txn.id}
                      className="flex items-center justify-between py-2 px-4"
                    >
                      <div>
                        <p className="text-sm text-foreground">
                          {txn.merchant || txn.description || "Unknown"}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDate(txn.date)} ·{" "}
                          {txn.categories?.name || "Uncategorized"}
                        </p>
                      </div>
                      <p
                        className={`text-sm font-semibold num ${txn.is_income ? "text-surplus" : ""}`}
                      >
                        {txn.is_income ? "+" : "-"}
                        {formatCurrency(Number(txn.amount))}
                      </p>
                    </Card>
                  ))
                )}
              </div>
            )}

            {tab === "subscriptions" && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowSubForm(!showSubForm)}
                    className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-hover"
                  >
                    <Plus className="h-4 w-4" />
                    Add Subscription
                  </button>
                </div>
                {showSubForm && (
                  <Card>
                    <form action={addSubscription} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          name="name"
                          placeholder="Name"
                          required
                          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
                        />
                        <input
                          name="amount"
                          type="number"
                          step="0.01"
                          placeholder="Amount"
                          required
                          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
                        />
                        <input
                          name="next_charge_date"
                          type="date"
                          required
                          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                        />
                        <select
                          name="frequency"
                          defaultValue="monthly"
                          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
                        >
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="weekly">Weekly</option>
                        </select>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowSubForm(false)}
                          className="rounded-lg px-3 py-2 text-sm text-muted"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-hover"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  </Card>
                )}
                {subscriptions.map((sub) => (
                  <Card
                    key={sub.id}
                    className={`flex items-center gap-3 py-3 px-4 ${!sub.is_active ? "opacity-50" : ""}`}
                  >
                    <RotateCw className="h-4 w-4 text-muted" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {sub.name}
                      </p>
                      <p className="text-xs text-muted">
                        {sub.frequency} · Next:{" "}
                        {formatRelativeDate(sub.next_charge_date)}
                      </p>
                    </div>
                    <p className="text-sm font-semibold num">
                      {formatCurrency(Number(sub.amount))}
                    </p>
                    <button
                      onClick={() => toggleSub(sub.id, sub.is_active)}
                      className="text-xs text-muted hover:text-terracotta"
                    >
                      {sub.is_active ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <RotateCw className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </Tabs>
    </div>
  );
}
