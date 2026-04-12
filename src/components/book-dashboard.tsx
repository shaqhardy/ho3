"use client";

import { useState } from "react";
import { Card, StatCard } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { formatCurrency, formatDate, formatRelativeDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Account, Transaction, Subscription, Category, Book } from "@/lib/types";
import { AccountsList } from "@/components/personal/accounts-list";
import { Plus, RotateCw, Pause } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">{bookLabel}</h1>

      <Tabs tabs={tabs} defaultTab="overview">
        {(tab) => (
          <>
            {tab === "overview" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Total Balance"
                    value={formatCurrency(totalBalance)}
                  />
                  <StatCard
                    label="This Month's Expenses"
                    value={formatCurrency(monthExpenses)}
                    color="text-deficit"
                  />
                  <StatCard
                    label="Monthly Subscriptions"
                    value={formatCurrency(totalMonthlySubs)}
                    color="text-warning"
                  />
                </div>

                {/* Upcoming subscriptions */}
                {upcomingSubs.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-muted mb-2">
                      Upcoming Charges
                    </h3>
                    <div className="space-y-2">
                      {upcomingSubs.slice(0, 5).map((sub) => (
                        <Card
                          key={sub.id}
                          className="flex items-center justify-between py-2 px-4"
                        >
                          <div>
                            <p className="text-sm text-foreground">
                              {sub.name}
                            </p>
                            <p className="text-xs text-muted">
                              {formatRelativeDate(sub.next_charge_date)}
                            </p>
                          </div>
                          <p className="text-sm font-semibold">
                            {formatCurrency(Number(sub.amount))}
                          </p>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expenses by category */}
                {Object.keys(expensesByCategory).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-muted mb-2">
                      Expenses by Category
                    </h3>
                    <div className="space-y-1">
                      {Object.entries(expensesByCategory)
                        .sort(([, a], [, b]) => b - a)
                        .map(([cat, amount]) => (
                          <div
                            key={cat}
                            className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-card"
                          >
                            <span className="text-sm text-foreground">
                              {cat}
                            </span>
                            <span className="text-sm font-medium">
                              {formatCurrency(amount)}
                            </span>
                          </div>
                        ))}
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
                        className={`text-sm font-semibold ${txn.is_income ? "text-surplus" : ""}`}
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
                    <p className="text-sm font-semibold">
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
