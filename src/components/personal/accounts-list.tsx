"use client";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { Account } from "@/lib/types";
import { Landmark, CreditCard, PiggyBank, TrendingUp } from "lucide-react";
import { isLiability } from "@/lib/accounts/money";

const typeIcons: Record<string, typeof Landmark> = {
  depository: Landmark,
  credit: CreditCard,
  loan: PiggyBank,
  investment: TrendingUp,
};

export function AccountsList({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) {
    return (
      <Card className="text-center py-12">
        <p className="text-muted">
          No accounts connected yet. Use the button above to link a bank
          account.
        </p>
      </Card>
    );
  }

  const grouped = accounts.reduce(
    (acc, account) => {
      const type = account.type || "other";
      if (!acc[type]) acc[type] = [];
      acc[type].push(account);
      return acc;
    },
    {} as Record<string, Account[]>
  );

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([type, accts]) => {
        const Icon = typeIcons[type] || Landmark;
        const isLia = isLiability(type);
        const total = accts.reduce(
          (sum, a) => sum + Number(a.current_balance),
          0
        );

        return (
          <div key={type}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted" />
                <h3 className="text-sm font-medium text-muted capitalize">
                  {type}
                  {isLia && (
                    <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-deficit">
                      Owed
                    </span>
                  )}
                </h3>
              </div>
              <span
                className={`text-sm font-medium ${isLia ? "text-deficit" : "text-foreground"}`}
              >
                {isLia ? "Owed: " : ""}
                {formatCurrency(total)}
              </span>
            </div>
            <div className="space-y-2">
              {accts.map((account) => (
                <Card
                  key={account.id}
                  className="flex items-center justify-between py-3 px-4"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {account.name}
                    </p>
                    {account.mask && (
                      <p className="text-xs text-muted">
                        ••••{account.mask}
                        {account.subtype && ` · ${account.subtype}`}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${isLia ? "text-deficit" : "text-foreground"}`}
                    >
                      {isLia ? "Owed: " : ""}
                      {formatCurrency(Number(account.current_balance))}
                    </p>
                    {account.available_balance !== null && !isLia && (
                      <p className="text-xs text-muted">
                        {formatCurrency(Number(account.available_balance))}{" "}
                        available
                      </p>
                    )}
                    {isLia && account.available_balance !== null && (
                      <p className="text-xs text-muted">
                        {formatCurrency(Number(account.available_balance))}{" "}
                        available credit
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
