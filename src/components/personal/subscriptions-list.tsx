"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatRelativeDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Subscription } from "@/lib/types";
import { Plus, RotateCw, Pause } from "lucide-react";

export function SubscriptionsList({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const active = subscriptions.filter((s) => s.is_active);
  const paused = subscriptions.filter((s) => !s.is_active);

  const totalMonthly = active.reduce((sum, s) => {
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

  async function addSubscription(formData: FormData) {
    const supabase = createClient();
    await supabase.from("subscriptions").insert({
      book: "personal",
      name: formData.get("name") as string,
      amount: parseFloat(formData.get("amount") as string),
      next_charge_date: formData.get("next_charge_date") as string,
      frequency: formData.get("frequency") as string,
      is_active: true,
    });
    setShowForm(false);
    router.refresh();
  }

  async function toggleActive(id: string, currentlyActive: boolean) {
    const supabase = createClient();
    await supabase
      .from("subscriptions")
      .update({ is_active: !currentlyActive })
      .eq("id", id);
    router.refresh();
  }

  function renderSubscription(sub: Subscription) {
    return (
      <Card
        key={sub.id}
        className={`flex items-center gap-3 py-3 px-4 ${!sub.is_active ? "opacity-50" : ""}`}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-card-hover">
          <RotateCw className="h-4 w-4 text-muted" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {sub.name}
          </p>
          <p className="text-xs text-muted">
            {sub.frequency} · Next: {formatRelativeDate(sub.next_charge_date)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold text-foreground">
            {formatCurrency(Number(sub.amount))}
          </p>
          <button
            onClick={() => toggleActive(sub.id, sub.is_active)}
            className="text-xs text-muted hover:text-terracotta transition-colors"
            title={sub.is_active ? "Pause" : "Resume"}
          >
            {sub.is_active ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Total monthly:{" "}
          <span className="font-semibold text-warning">
            {formatCurrency(totalMonthly)}
          </span>
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover"
        >
          <Plus className="h-4 w-4" />
          Add Subscription
        </button>
      </div>

      {showForm && (
        <Card>
          <form action={addSubscription} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                name="name"
                placeholder="Subscription name"
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
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
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

      {active.length === 0 && paused.length === 0 && !showForm ? (
        <Card className="text-center py-12">
          <p className="text-muted">No subscriptions tracked yet.</p>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-2">
              {active.map(renderSubscription)}
            </div>
          )}
          {paused.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted mt-4">Paused</p>
              <div className="space-y-2">
                {paused.map(renderSubscription)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
