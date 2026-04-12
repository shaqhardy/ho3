"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatRelativeDate, daysUntil } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Bill } from "@/lib/types";
import { Plus, Calendar, AlertTriangle, Check } from "lucide-react";

export function BillsList({ bills }: { bills: Bill[] }) {
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  async function addBill(formData: FormData) {
    const supabase = createClient();
    await supabase.from("bills").insert({
      book: "personal",
      name: formData.get("name") as string,
      amount: parseFloat(formData.get("amount") as string),
      due_date: formData.get("due_date") as string,
      priority_tier: formData.get("priority_tier") as string,
      status: "upcoming",
      is_recurring: true,
      frequency: (formData.get("frequency") as string) || "monthly",
    });
    setShowForm(false);
    router.refresh();
  }

  async function markPaid(billId: string) {
    const supabase = createClient();
    await supabase
      .from("bills")
      .update({ status: "paid" })
      .eq("id", billId);
    router.refresh();
  }

  async function updateDueDate(billId: string, newDate: string) {
    const supabase = createClient();
    await supabase
      .from("bills")
      .update({ due_date: newDate })
      .eq("id", billId);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover"
        >
          <Plus className="h-4 w-4" />
          Add Bill
        </button>
      </div>

      {showForm && (
        <Card>
          <form action={addBill} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                name="name"
                placeholder="Bill name"
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
                name="due_date"
                type="date"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
              />
              <select
                name="priority_tier"
                defaultValue="2"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
              >
                <option value="1">Tier 1 — Must pay</option>
                <option value="2">Tier 2 — Important</option>
                <option value="3">Tier 3 — Discretionary</option>
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

      {bills.length === 0 && !showForm ? (
        <Card className="text-center py-12">
          <p className="text-muted">
            No bills added yet. Click &quot;Add Bill&quot; to get started.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {bills.map((bill) => {
            const days = daysUntil(bill.due_date);
            const isOverdue = days < 0 && bill.status !== "paid";
            const isDueSoon = days >= 0 && days <= 3 && bill.status !== "paid";

            return (
              <Card
                key={bill.id}
                className={`flex items-center gap-3 py-3 px-4 ${
                  isOverdue ? "border-deficit/30" : isDueSoon ? "border-warning/30" : ""
                }`}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    bill.status === "paid"
                      ? "bg-surplus/10"
                      : isOverdue
                        ? "bg-deficit/10"
                        : "bg-card-hover"
                  }`}
                >
                  {bill.status === "paid" ? (
                    <Check className="h-4 w-4 text-surplus" />
                  ) : isOverdue ? (
                    <AlertTriangle className="h-4 w-4 text-deficit" />
                  ) : (
                    <Calendar className="h-4 w-4 text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {bill.name}
                    </p>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        bill.priority_tier === "1"
                          ? "bg-deficit/10 text-deficit"
                          : bill.priority_tier === "2"
                            ? "bg-warning/10 text-warning"
                            : "bg-card-hover text-muted"
                      }`}
                    >
                      T{bill.priority_tier}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      type="date"
                      value={bill.due_date}
                      onChange={(e) => updateDueDate(bill.id, e.target.value)}
                      className="text-xs text-muted bg-transparent border-none p-0 focus:outline-none cursor-pointer"
                    />
                    <span
                      className={`text-xs ${
                        isOverdue
                          ? "text-deficit"
                          : isDueSoon
                            ? "text-warning"
                            : "text-muted"
                      }`}
                    >
                      {formatRelativeDate(bill.due_date)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-foreground">
                    {formatCurrency(Number(bill.amount))}
                  </p>
                  {bill.status !== "paid" && (
                    <button
                      onClick={() => markPaid(bill.id)}
                      className="text-xs text-muted hover:text-surplus transition-colors"
                    >
                      Pay
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
