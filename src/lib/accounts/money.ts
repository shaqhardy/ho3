// Money math that knows the difference between assets and liabilities.
//
// Plaid's `accounts` table stores `current_balance` as a positive number for
// both assets *and* liabilities. For a credit card, current_balance is the
// amount owed — it must be subtracted from net worth, never added. Before this
// module existed, several aggregations just summed every account regardless of
// type, which counted a $1,000 credit-card balance as +$1,000 net worth.

export type AssetKind = "asset" | "liability";

export interface MoneyAccount {
  type: string;
  current_balance: number | string | null;
  available_balance?: number | string | null;
}

const LIABILITY_TYPES = new Set(["credit", "loan"]);

export function accountKind(type: string | null | undefined): AssetKind {
  return type && LIABILITY_TYPES.has(type) ? "liability" : "asset";
}

export function isLiability(type: string | null | undefined): boolean {
  return accountKind(type) === "liability";
}

export function isAsset(type: string | null | undefined): boolean {
  return accountKind(type) === "asset";
}

function n(v: number | string | null | undefined): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Contribution of one account to net worth: positive for assets, negative for
 * liabilities. Use this when you want a single signed number per account.
 */
export function signedNetWorthBalance(a: MoneyAccount): number {
  const bal = n(a.current_balance);
  return isLiability(a.type) ? -bal : bal;
}

/** Net worth = total assets − total liabilities. */
export function netWorth(accounts: MoneyAccount[]): number {
  return accounts.reduce((sum, a) => sum + signedNetWorthBalance(a), 0);
}

/** Sum of asset balances only (depository + investment + anything non-liability). */
export function totalAssets(accounts: MoneyAccount[]): number {
  return accounts
    .filter((a) => isAsset(a.type))
    .reduce((sum, a) => sum + n(a.current_balance), 0);
}

/** Sum of liability balances only (credit + loan), returned as a positive number. */
export function totalLiabilities(accounts: MoneyAccount[]): number {
  return accounts
    .filter((a) => isLiability(a.type))
    .reduce((sum, a) => sum + n(a.current_balance), 0);
}

/**
 * Current cash: only depository accounts count. Investments are illiquid;
 * credit/loan are money owed, not money held. Prefers `available_balance` when
 * present because that's the spendable figure for checking/savings.
 */
export function totalCash(accounts: MoneyAccount[]): number {
  return accounts
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + n(a.available_balance ?? a.current_balance), 0);
}
