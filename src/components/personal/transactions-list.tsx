"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Transaction, Category } from "@/lib/types";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

interface TransactionWithCategory extends Transaction {
  categories: { name: string } | null;
}

export function TransactionsList({
  transactions,
  categories,
}: {
  transactions: TransactionWithCategory[];
  categories: Category[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const router = useRouter();

  async function updateCategory(transactionId: string, categoryId: string) {
    const supabase = createClient();

    // Get the transaction's merchant for auto-rule creation
    const txn = transactions.find((t) => t.id === transactionId);

    await supabase
      .from("transactions")
      .update({ category_id: categoryId || null })
      .eq("id", transactionId);

    // Auto-create category rule for this merchant
    if (txn?.merchant && categoryId) {
      const { data: existing } = await supabase
        .from("category_rules")
        .select("id")
        .eq("merchant_pattern", txn.merchant)
        .eq("book", "personal")
        .limit(1);

      if (!existing?.length) {
        await supabase.from("category_rules").insert({
          merchant_pattern: txn.merchant,
          category_id: categoryId,
          book: "personal",
        });
      } else {
        await supabase
          .from("category_rules")
          .update({ category_id: categoryId })
          .eq("merchant_pattern", txn.merchant)
          .eq("book", "personal");
      }
    }

    setEditingId(null);
    router.refresh();
  }

  if (transactions.length === 0) {
    return (
      <Card className="text-center py-12">
        <p className="text-muted">
          No transactions yet. Connect a bank account to start syncing.
        </p>
      </Card>
    );
  }

  // Group by date
  const grouped = transactions.reduce(
    (acc, txn) => {
      if (!acc[txn.date]) acc[txn.date] = [];
      acc[txn.date].push(txn);
      return acc;
    },
    {} as Record<string, TransactionWithCategory[]>
  );

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([date, txns]) => (
        <div key={date}>
          <p className="text-xs font-medium text-muted mb-2">
            {formatDate(date)}
          </p>
          <div className="space-y-1">
            {txns.map((txn) => (
              <Card
                key={txn.id}
                className="flex items-center gap-3 py-3 px-4"
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    txn.is_income ? "bg-surplus/10" : "bg-deficit/10"
                  }`}
                >
                  {txn.is_income ? (
                    <ArrowDownLeft className="h-4 w-4 text-surplus" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-deficit" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {txn.merchant || txn.description || "Unknown"}
                  </p>
                  {editingId === txn.id ? (
                    <select
                      value={selectedCategory}
                      onChange={(e) => {
                        updateCategory(txn.id, e.target.value);
                      }}
                      onBlur={() => setEditingId(null)}
                      autoFocus
                      className="mt-0.5 text-xs bg-card border border-border rounded px-1 py-0.5 text-muted"
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(txn.id);
                        setSelectedCategory(txn.category_id || "");
                      }}
                      className="text-xs text-muted hover:text-terracotta transition-colors"
                    >
                      {txn.categories?.name || "Uncategorized"}
                    </button>
                  )}
                </div>
                <p
                  className={`text-sm font-semibold whitespace-nowrap ${
                    txn.is_income ? "text-surplus" : "text-foreground"
                  }`}
                >
                  {txn.is_income ? "+" : "-"}
                  {formatCurrency(Number(txn.amount))}
                </p>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
