"use client";

import { useState } from "react";
import { Card, StatCard } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Debt, DebtStatement } from "@/lib/types";
import {
  Plus,
  Upload,
  Check,
  TrendingDown,
  CreditCard,
} from "lucide-react";

function calculatePayoff(
  balance: number,
  apr: number,
  minPayment: number
): { months: number; totalInterest: number } {
  if (minPayment <= 0 || balance <= 0) return { months: 0, totalInterest: 0 };

  const monthlyRate = apr / 100 / 12;
  let remaining = balance;
  let months = 0;
  let totalInterest = 0;

  while (remaining > 0 && months < 600) {
    const interest = remaining * monthlyRate;
    totalInterest += interest;
    const principal = Math.min(minPayment - interest, remaining);
    if (principal <= 0) return { months: 999, totalInterest: 999999 };
    remaining -= principal;
    months++;
  }

  return { months, totalInterest };
}

export function DebtModule({
  debts,
  statements,
}: {
  debts: Debt[];
  statements: DebtStatement[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [uploadingDebtId, setUploadingDebtId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();

  const totalDebt = debts.reduce(
    (sum, d) => sum + Number(d.current_balance),
    0
  );
  const totalMinimum = debts.reduce(
    (sum, d) => sum + Number(d.minimum_payment),
    0
  );
  const weightedApr =
    totalDebt > 0
      ? debts.reduce(
          (sum, d) =>
            sum + (Number(d.apr) * Number(d.current_balance)) / totalDebt,
          0
        )
      : 0;

  async function addDebt(formData: FormData) {
    const supabase = createClient();
    await supabase.from("debts").insert({
      book: "personal",
      creditor: formData.get("creditor") as string,
      nickname: (formData.get("nickname") as string) || null,
      current_balance: parseFloat(formData.get("current_balance") as string),
      apr: parseFloat(formData.get("apr") as string),
      minimum_payment: parseFloat(formData.get("minimum_payment") as string),
      statement_due_date: formData.get("statement_due_date") as string,
    });
    setShowForm(false);
    router.refresh();
  }

  async function handleUpload(debtId: string, file: File) {
    setUploading(true);
    const supabase = createClient();

    const filePath = `statements/${debtId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(filePath, file);

    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    // Run OCR
    const res = await fetch("/api/ocr/parse-statement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_url: filePath, debt_id: debtId }),
    });

    const data = await res.json();

    if (data.statement && data.parsed) {
      // Show parsed data for confirmation
      const confirmUpdate = confirm(
        `OCR found:\n` +
          `Balance: ${data.parsed.current_balance ? formatCurrency(data.parsed.current_balance) : "N/A"}\n` +
          `Minimum: ${data.parsed.minimum_payment ? formatCurrency(data.parsed.minimum_payment) : "N/A"}\n` +
          `Due: ${data.parsed.due_date || "N/A"}\n\n` +
          `Apply these values to the debt account?`
      );

      if (confirmUpdate) {
        const updates: Record<string, unknown> = {};
        if (data.parsed.current_balance)
          updates.current_balance = data.parsed.current_balance;
        if (data.parsed.minimum_payment)
          updates.minimum_payment = data.parsed.minimum_payment;
        if (data.parsed.due_date)
          updates.statement_due_date = data.parsed.due_date;
        if (data.parsed.apr) updates.apr = data.parsed.apr;

        if (Object.keys(updates).length > 0) {
          await supabase
            .from("debts")
            .update(updates)
            .eq("id", debtId);
        }

        // Mark statement as confirmed
        await supabase
          .from("debt_statements")
          .update({ confirmed: true })
          .eq("id", data.statement.id);
      }
    }

    setUploading(false);
    setUploadingDebtId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Debt Accounts</h1>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              await fetch("/api/plaid/sync-liabilities", { method: "POST" });
              router.refresh();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground hover:bg-card-hover"
          >
            Sync from Plaid
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover"
          >
            <Plus className="h-4 w-4" />
            Add Debt
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total Debt"
          value={formatCurrency(totalDebt)}
          color="text-deficit"
        />
        <StatCard
          label="Monthly Minimums"
          value={formatCurrency(totalMinimum)}
          color="text-warning"
        />
        <StatCard
          label="Weighted Avg APR"
          value={`${weightedApr.toFixed(1)}%`}
          color="text-muted"
        />
      </div>

      {showForm && (
        <Card>
          <form action={addDebt} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                name="creditor"
                placeholder="Creditor name"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="nickname"
                placeholder="Nickname (optional)"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="current_balance"
                type="number"
                step="0.01"
                placeholder="Current balance"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="apr"
                type="number"
                step="0.01"
                placeholder="APR %"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="minimum_payment"
                type="number"
                step="0.01"
                placeholder="Minimum payment"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-muted focus:border-terracotta focus:outline-none"
              />
              <input
                name="statement_due_date"
                type="date"
                required
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-terracotta focus:outline-none"
              />
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

      {debts.length === 0 && !showForm ? (
        <Card className="text-center py-12">
          <CreditCard className="mx-auto h-8 w-8 text-muted mb-3" />
          <p className="text-muted">No debt accounts added yet.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {debts.map((debt) => {
            // Use stored projections from Plaid sync, fall back to client calc
            const payoff = debt.projected_payoff_months != null
              ? {
                  months: debt.projected_payoff_months as number,
                  totalInterest: Number(debt.projected_total_interest) || 0,
                }
              : calculatePayoff(
                  Number(debt.current_balance),
                  Number(debt.apr),
                  Number(debt.minimum_payment)
                );
            const debtStatements = statements.filter(
              (s) => s.debt_id === debt.id
            );

            return (
              <Card key={debt.id} className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      {debt.creditor}
                    </h3>
                    {debt.nickname && (
                      <p className="text-xs text-muted">{debt.nickname}</p>
                    )}
                  </div>
                  <p className="text-lg font-bold text-deficit">
                    {formatCurrency(Number(debt.current_balance))}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted">APR</p>
                    <p className="font-medium">{Number(debt.apr)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Min Payment</p>
                    <p className="font-medium">
                      {formatCurrency(Number(debt.minimum_payment))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Due Date</p>
                    <p className="font-medium">
                      {formatDate(debt.statement_due_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Payoff (min only)</p>
                    <p className="font-medium">
                      {payoff.months >= 999
                        ? "Never"
                        : `${payoff.months} months`}
                    </p>
                    {payoff.totalInterest < 999999 && (
                      <p className="text-xs text-deficit">
                        {formatCurrency(payoff.totalInterest)} interest
                      </p>
                    )}
                  </div>
                </div>
                {debt.last_synced_at && (
                  <p className="text-[10px] text-muted">
                    Last synced: {new Date(String(debt.last_synced_at)).toLocaleString()}
                  </p>
                )}

                {/* Statement upload */}
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-muted" />
                    <p className="text-xs text-muted">
                      {debtStatements.length} statement
                      {debtStatements.length !== 1 ? "s" : ""} on file
                    </p>
                  </div>
                  {uploadingDebtId === debt.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        disabled={uploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(debt.id, file);
                        }}
                        className="text-xs text-muted"
                      />
                      {uploading && (
                        <span className="text-xs text-terracotta">
                          Processing...
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => setUploadingDebtId(debt.id)}
                      className="flex items-center gap-1.5 text-xs text-muted hover:text-terracotta transition-colors"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload Statement
                    </button>
                  )}
                </div>

                {/* Recent statements */}
                {debtStatements.length > 0 && (
                  <div className="space-y-1">
                    {debtStatements.slice(0, 3).map((stmt) => (
                      <div
                        key={stmt.id}
                        className="flex items-center justify-between text-xs py-1"
                      >
                        <div className="flex items-center gap-2">
                          {stmt.confirmed ? (
                            <Check className="h-3 w-3 text-surplus" />
                          ) : (
                            <span className="h-3 w-3 rounded-full bg-warning/30" />
                          )}
                          <span className="text-muted">
                            {formatDate(stmt.statement_date)}
                          </span>
                        </div>
                        <div className="flex gap-4 text-muted">
                          {stmt.parsed_balance && (
                            <span>
                              Bal: {formatCurrency(Number(stmt.parsed_balance))}
                            </span>
                          )}
                          {stmt.parsed_minimum && (
                            <span>
                              Min: {formatCurrency(Number(stmt.parsed_minimum))}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
