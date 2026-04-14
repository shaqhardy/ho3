// Advance a bill's next due date by one period. Used both when the user marks
// a bill paid manually and when the Plaid sync auto-matches a payment.
//
// `due_date` is always stored as an absolute YYYY-MM-DD; we bump it by the
// bill's `frequency`. If frequency is null or is_recurring=false, we leave it
// alone (one-shot bill).

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly" | null;

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function advanceDueDate(
  currentDue: string,
  frequency: Frequency,
  isRecurring: boolean,
  preferredDay?: number | null
): string | null {
  if (!isRecurring || !frequency) return null;
  const d = parseYmd(currentDue);

  if (frequency === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
    return toYmd(d);
  }

  // Month-based frequencies: advance month count on first-of-month to avoid
  // JS's day-overflow (Jan 31 + 1 month → March 3 normally), then clamp day.
  const stepMonths =
    frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;

  const origDay = d.getUTCDate();
  const startYear = d.getUTCFullYear();
  const startMonth = d.getUTCMonth();
  const targetMonthIdx = startMonth + stepMonths;
  const targetYear = startYear + Math.floor(targetMonthIdx / 12);
  const targetMonth = ((targetMonthIdx % 12) + 12) % 12;
  const lastDayOfTarget = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate();
  const day = Math.min(preferredDay || origDay, lastDayOfTarget);
  return toYmd(new Date(Date.UTC(targetYear, targetMonth, day)));
}

/**
 * True if a transaction amount matches a bill's expected amount within
 * tolerance. For variable bills the tolerance is generous (±25% of the typical
 * amount, or at least $5); for fixed bills it's ±1% (or $1).
 */
export function amountMatches(
  txnAmount: number,
  bill: {
    amount: number | string | null;
    variable: boolean;
    typical_amount: number | string | null;
  }
): boolean {
  const expected = Number(
    bill.variable ? bill.typical_amount ?? bill.amount ?? 0 : bill.amount ?? 0
  );
  if (expected <= 0) return false;
  const tol = bill.variable
    ? Math.max(expected * 0.25, 5)
    : Math.max(expected * 0.01, 1);
  return Math.abs(txnAmount - expected) <= tol;
}
