// Amortization math for credit-card and loan payoff projections.
// Used by the Debts page command center and account detail pages.

export interface DebtLike {
  id: string;
  current_balance: number;
  apr: number;             // annual % e.g. 22.99
  minimum_payment: number; // monthly $
  creditor: string;
  nickname?: string | null;
  color?: string | null;
}

export interface PayoffSummary {
  months: number;          // months until paid off (>=600 means "never")
  totalInterest: number;
  totalPaid: number;
  payoffDate: string;      // YYYY-MM-DD
  monthlySchedule: ScheduleRow[];
}

export interface ScheduleRow {
  month: number;           // 0 = today, 1 = first month after, etc.
  date: string;            // YYYY-MM-DD (first of the month)
  balance: number;         // remaining at end of this month
  interest: number;
  principal: number;
  payment: number;
}

const NEVER = { months: 999, totalInterest: 0 };

function addMonthsYmd(start: Date, n: number): string {
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Standard fixed-payment amortization. Returns full month-by-month schedule.
 * If the payment can't cover monthly interest, marks as never-payoff and
 * returns an empty schedule.
 */
export function amortize(
  balance: number,
  apr: number,
  monthlyPayment: number,
  start: Date = new Date(),
): PayoffSummary {
  const startTrunc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  if (balance <= 0) {
    return {
      months: 0,
      totalInterest: 0,
      totalPaid: 0,
      payoffDate: addMonthsYmd(startTrunc, 0),
      monthlySchedule: [],
    };
  }
  const monthlyRate = apr / 100 / 12;
  if (monthlyPayment <= balance * monthlyRate) {
    return {
      months: NEVER.months,
      totalInterest: NEVER.totalInterest,
      totalPaid: NEVER.totalInterest,
      payoffDate: addMonthsYmd(startTrunc, 600),
      monthlySchedule: [],
    };
  }

  let remaining = balance;
  let totalInterest = 0;
  let totalPaid = 0;
  const schedule: ScheduleRow[] = [];
  let m = 0;
  while (remaining > 0 && m < 600) {
    m += 1;
    const interest = remaining * monthlyRate;
    const payment = Math.min(monthlyPayment, remaining + interest);
    const principal = payment - interest;
    remaining = Math.max(0, remaining - principal);
    totalInterest += interest;
    totalPaid += payment;
    schedule.push({
      month: m,
      date: addMonthsYmd(startTrunc, m),
      balance: remaining,
      interest,
      principal,
      payment,
    });
  }

  return {
    months: m,
    totalInterest,
    totalPaid,
    payoffDate: schedule[schedule.length - 1]?.date ?? addMonthsYmd(startTrunc, m),
    monthlySchedule: schedule,
  };
}

/**
 * Same as amortize but adds an extra payment each month, biweekly extra
 * (~13th payment), or a one-time lump sum applied in month 1.
 */
export interface ExtraPayment {
  amount: number;
  frequency: "monthly" | "biweekly" | "lump";
}

export function amortizeWithExtra(
  balance: number,
  apr: number,
  minPayment: number,
  extra: ExtraPayment,
  start: Date = new Date(),
): PayoffSummary {
  const startTrunc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  if (balance <= 0) {
    return {
      months: 0,
      totalInterest: 0,
      totalPaid: 0,
      payoffDate: addMonthsYmd(startTrunc, 0),
      monthlySchedule: [],
    };
  }
  const monthlyRate = apr / 100 / 12;
  let remaining = balance;
  let totalInterest = 0;
  let totalPaid = 0;
  const schedule: ScheduleRow[] = [];
  let m = 0;

  while (remaining > 0 && m < 600) {
    m += 1;
    const interest = remaining * monthlyRate;
    let payment = minPayment;
    if (extra.frequency === "monthly") payment += extra.amount;
    else if (extra.frequency === "biweekly") {
      // Biweekly = 26 payments / yr → effectively one extra monthly payment / yr.
      payment += extra.amount * (26 / 12);
    } else if (extra.frequency === "lump" && m === 1) {
      payment += extra.amount;
    }
    if (payment <= interest) {
      // Can't pay down — return never.
      return {
        months: NEVER.months,
        totalInterest: NEVER.totalInterest,
        totalPaid: NEVER.totalInterest,
        payoffDate: addMonthsYmd(startTrunc, 600),
        monthlySchedule: [],
      };
    }
    payment = Math.min(payment, remaining + interest);
    const principal = payment - interest;
    remaining = Math.max(0, remaining - principal);
    totalInterest += interest;
    totalPaid += payment;
    schedule.push({
      month: m,
      date: addMonthsYmd(startTrunc, m),
      balance: remaining,
      interest,
      principal,
      payment,
    });
  }

  return {
    months: m,
    totalInterest,
    totalPaid,
    payoffDate: schedule[schedule.length - 1]?.date ?? addMonthsYmd(startTrunc, m),
    monthlySchedule: schedule,
  };
}

/**
 * Allocate a global "extra payment per month" pool across a list of debts
 * using either the avalanche (highest APR first) or snowball (smallest
 * balance first) strategy. All minimums are paid every month; the extra is
 * concentrated on the focus debt until it's gone, then rolled to the next.
 *
 * Returns per-debt projection with and without the extras, plus a portfolio
 * timeline for stacked-area chart.
 */
export type Strategy = "avalanche" | "snowball";

export interface PortfolioMonth {
  month: number;
  date: string;
  totalBalance: number;
  byDebt: Record<string, number>; // debt id → balance
}

export interface PortfolioProjection {
  months: number;            // months until last debt paid
  payoffDate: string;
  totalInterest: number;
  totalPaid: number;
  perDebt: Record<string, PayoffSummary>;
  timeline: PortfolioMonth[];
}

function orderForStrategy(debts: DebtLike[], s: Strategy): DebtLike[] {
  const arr = [...debts];
  if (s === "avalanche") arr.sort((a, b) => b.apr - a.apr || b.current_balance - a.current_balance);
  else arr.sort((a, b) => a.current_balance - b.current_balance || b.apr - a.apr);
  return arr;
}

export function projectPortfolio(
  debts: DebtLike[],
  monthlyExtra: number,
  strategy: Strategy,
  start: Date = new Date(),
): PortfolioProjection {
  const startTrunc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const order = orderForStrategy(debts, strategy);
  const balances = new Map<string, number>(order.map((d) => [d.id, d.current_balance]));
  const apr = new Map<string, number>(order.map((d) => [d.id, d.apr]));
  const min = new Map<string, number>(order.map((d) => [d.id, d.minimum_payment]));
  const interestById = new Map<string, number>(order.map((d) => [d.id, 0]));
  const paidById = new Map<string, number>(order.map((d) => [d.id, 0]));
  const monthsToPayoff = new Map<string, number>();

  const timeline: PortfolioMonth[] = [];
  // Month 0 snapshot:
  timeline.push({
    month: 0,
    date: addMonthsYmd(startTrunc, 0),
    totalBalance: order.reduce((s, d) => s + d.current_balance, 0),
    byDebt: Object.fromEntries(order.map((d) => [d.id, d.current_balance])),
  });

  let m = 0;
  let totalInterest = 0;
  let totalPaid = 0;

  while (
    order.some((d) => (balances.get(d.id) ?? 0) > 0.005) &&
    m < 600
  ) {
    m += 1;
    let pool = monthlyExtra;
    // 1) Charge interest and pay minimums
    for (const d of order) {
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0) continue;
      const r = (apr.get(d.id) ?? 0) / 100 / 12;
      const interest = bal * r;
      let payment = Math.min(min.get(d.id) ?? 0, bal + interest);
      if (payment <= interest) {
        // Couldn't even cover interest — stop pretending.
        balances.set(d.id, bal + interest - payment);
        interestById.set(d.id, (interestById.get(d.id) ?? 0) + interest);
        paidById.set(d.id, (paidById.get(d.id) ?? 0) + payment);
        totalInterest += interest;
        totalPaid += payment;
        continue;
      }
      const principal = payment - interest;
      balances.set(d.id, bal - principal);
      interestById.set(d.id, (interestById.get(d.id) ?? 0) + interest);
      paidById.set(d.id, (paidById.get(d.id) ?? 0) + payment);
      totalInterest += interest;
      totalPaid += payment;
    }
    // 2) Apply extras to focus debt(s) in strategy order
    for (const d of order) {
      if (pool <= 0) break;
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0) continue;
      const apply = Math.min(pool, bal);
      balances.set(d.id, bal - apply);
      paidById.set(d.id, (paidById.get(d.id) ?? 0) + apply);
      totalPaid += apply;
      pool -= apply;
    }
    // 3) Record month-end + payoff timestamps
    for (const d of order) {
      const bal = balances.get(d.id) ?? 0;
      if (bal <= 0.005 && !monthsToPayoff.has(d.id)) {
        monthsToPayoff.set(d.id, m);
      }
    }
    timeline.push({
      month: m,
      date: addMonthsYmd(startTrunc, m),
      totalBalance: order.reduce((s, d) => s + Math.max(0, balances.get(d.id) ?? 0), 0),
      byDebt: Object.fromEntries(
        order.map((d) => [d.id, Math.max(0, balances.get(d.id) ?? 0)])
      ),
    });
  }

  const perDebt: Record<string, PayoffSummary> = {};
  for (const d of order) {
    const months = monthsToPayoff.get(d.id) ?? m;
    perDebt[d.id] = {
      months,
      totalInterest: interestById.get(d.id) ?? 0,
      totalPaid: paidById.get(d.id) ?? 0,
      payoffDate: addMonthsYmd(startTrunc, months),
      monthlySchedule: [],
    };
  }

  return {
    months: m,
    payoffDate: addMonthsYmd(startTrunc, m),
    totalInterest,
    totalPaid,
    perDebt,
    timeline,
  };
}

export function formatMonthsHuman(months: number): string {
  if (months >= 600) return "Never";
  if (months <= 0) return "Paid off";
  if (months < 12) return `${months}mo`;
  const y = Math.floor(months / 12);
  const r = months % 12;
  return r ? `${y}y ${r}mo` : `${y}y`;
}

export function formatYmdMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}
