// Map Plaid's personal_finance_category taxonomy to HO3's per-book category
// names. Kept conservative: we only emit a mapping when we're confident about
// the bucket. Anything ambiguous gets returned as null so the user can bulk-
// categorize it manually — better to under-categorize than to stuff half the
// ledger into "Other" and hide bad signal from the auto-budget.
//
// Plaid primary values (abridged):
//   INCOME, TRANSFER_IN, TRANSFER_OUT, LOAN_PAYMENTS, BANK_FEES,
//   ENTERTAINMENT, FOOD_AND_DRINK, GENERAL_MERCHANDISE, HOME_IMPROVEMENT,
//   MEDICAL, PERSONAL_CARE, GENERAL_SERVICES, GOVERNMENT_AND_NON_PROFIT,
//   TRANSPORTATION, TRAVEL, RENT_AND_UTILITIES

export type Book = "personal" | "business" | "nonprofit";

export interface PfcInput {
  primary: string | null | undefined;
  detailed: string | null | undefined;
}

/**
 * Returns a category NAME (not id) to look up against the `categories` table,
 * or null when we can't confidently pick one. Transfers deliberately return
 * null — they aren't real expenses and shouldn't show up in budgets.
 */
export function pfcToCategoryName(
  pfc: PfcInput,
  book: Book
): string | null {
  const p = (pfc.primary || "").toUpperCase();
  const d = (pfc.detailed || "").toUpperCase();
  if (!p) return null;

  // Transfers & income are never an expense category.
  if (p === "TRANSFER_IN" || p === "TRANSFER_OUT" || p === "INCOME") return null;

  if (book === "personal") {
    if (p === "LOAN_PAYMENTS") {
      // Mortgage payments are Housing; auto / student / credit-card payments are Debt.
      if (d.includes("MORTGAGE")) return "Housing";
      return "Debt Payments";
    }
    if (p === "RENT_AND_UTILITIES") {
      if (d.includes("RENT")) return "Housing";
      if (d.includes("INTERNET") || d.includes("CABLE")) return "Utilities";
      if (d.includes("TELEPHONE") || d.includes("PHONE")) return "Utilities";
      if (d.includes("GAS") || d.includes("ELECTRIC") || d.includes("WATER"))
        return "Utilities";
      return "Utilities";
    }
    if (p === "FOOD_AND_DRINK") {
      // Groceries maps cleanly. Restaurants/fast food land in Discretionary
      // since we don't have a dedicated Dining category.
      if (d.includes("GROCERIES")) return "Groceries";
      return "Discretionary";
    }
    if (p === "TRANSPORTATION") return "Transportation";
    if (p === "TRAVEL") return "Discretionary";
    if (p === "ENTERTAINMENT") return "Discretionary";
    if (p === "GENERAL_MERCHANDISE") return "Discretionary";
    if (p === "MEDICAL") return "Medical";
    if (p === "HOME_IMPROVEMENT") return "Housing";
    if (p === "PERSONAL_CARE") return "Discretionary";
    if (p === "GOVERNMENT_AND_NON_PROFIT") {
      if (d.includes("DONATION")) return "Giving";
      if (d.includes("TAX")) return "Other";
      return "Other";
    }
    if (p === "BANK_FEES") return "Other";
    if (p === "GENERAL_SERVICES") {
      if (d.includes("INSURANCE")) return "Insurance";
      if (d.includes("CHILDCARE") || d.includes("EDUCATION")) return "Kids";
      return "Other";
    }
    return null;
  }

  if (book === "business") {
    if (p === "LOAN_PAYMENTS") return "Other";
    if (p === "TRAVEL") return "Travel";
    if (p === "FOOD_AND_DRINK") return "Travel";
    if (p === "GENERAL_MERCHANDISE") return "Equipment";
    if (p === "GENERAL_SERVICES") {
      if (d.includes("ADVERTISING") || d.includes("MARKETING"))
        return "Marketing";
      if (d.includes("PROFESSIONAL") || d.includes("ACCOUNTING") || d.includes("LEGAL"))
        return "Professional Services";
      return "Office";
    }
    if (p === "RENT_AND_UTILITIES") return "Office";
    if (p === "ENTERTAINMENT") return "Marketing";
    if (p === "TRANSPORTATION") return "Travel";
    return null;
  }

  // nonprofit
  if (p === "LOAN_PAYMENTS") return "Admin";
  if (p === "GENERAL_SERVICES") return "Admin";
  if (p === "GENERAL_MERCHANDISE") return "Programs";
  if (p === "RENT_AND_UTILITIES") return "Admin";
  if (p === "TRAVEL" || p === "TRANSPORTATION") return "Programs";
  if (p === "ENTERTAINMENT") return "Fundraising";
  if (p === "FOOD_AND_DRINK") return "Programs";
  return null;
}
