import type { DistributionCadence } from "@/lib/types";

export interface OccurrenceInput {
  cadence: DistributionCadence;
  anchorDate: string; // YYYY-MM-DD
  customDays: number[] | null;
  /** Inclusive start boundary (YYYY-MM-DD). Occurrences on or after this. */
  from: string;
  /** Inclusive end boundary (YYYY-MM-DD). Occurrences on or before this. */
  to: string;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function addMonthsUtc(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  // Use day-clamping: last day of target month if source day doesn't exist.
  const targetMonthLastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, targetMonthLastDay)));
}

function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

/**
 * Generate every occurrence of a schedule within [from, to].
 * Returns date strings (YYYY-MM-DD). Does not deduplicate — callers
 * rely on the DB unique index (linked_schedule_id, date) instead.
 */
export function computeOccurrences(input: OccurrenceInput): string[] {
  const fromD = parseYmd(input.from);
  const toD = parseYmd(input.to);
  if (fromD > toD) return [];

  const anchor = parseYmd(input.anchorDate);
  const out: string[] = [];

  switch (input.cadence) {
    case "weekly": {
      let cursor = anchor;
      // Fast-forward cursor to first occurrence >= fromD.
      if (cursor < fromD) {
        const deltaDays = Math.floor(
          (fromD.getTime() - cursor.getTime()) / 86_400_000
        );
        const weeksToSkip = Math.floor(deltaDays / 7);
        cursor = addDaysUtc(cursor, weeksToSkip * 7);
        while (cursor < fromD) cursor = addDaysUtc(cursor, 7);
      }
      while (cursor <= toD) {
        out.push(formatYmd(cursor));
        cursor = addDaysUtc(cursor, 7);
      }
      break;
    }
    case "biweekly": {
      let cursor = anchor;
      if (cursor < fromD) {
        const deltaDays = Math.floor(
          (fromD.getTime() - cursor.getTime()) / 86_400_000
        );
        const periodsToSkip = Math.floor(deltaDays / 14);
        cursor = addDaysUtc(cursor, periodsToSkip * 14);
        while (cursor < fromD) cursor = addDaysUtc(cursor, 14);
      }
      while (cursor <= toD) {
        out.push(formatYmd(cursor));
        cursor = addDaysUtc(cursor, 14);
      }
      break;
    }
    case "semimonthly": {
      // Two payments per month on the anchor day-of-month and 15 days later,
      // both clamped to month length. If anchor is the 15th, use 15th + last.
      const anchorDay = anchor.getUTCDate();
      const secondDay = anchorDay === 15 ? 31 : anchorDay + 15;
      let y = fromD.getUTCFullYear();
      let m = fromD.getUTCMonth();
      while (true) {
        const dim = daysInMonth(y, m);
        const d1 = new Date(Date.UTC(y, m, Math.min(anchorDay, dim)));
        const d2 = new Date(Date.UTC(y, m, Math.min(secondDay, dim)));
        for (const cand of [d1, d2]) {
          if (cand >= fromD && cand <= toD) out.push(formatYmd(cand));
        }
        if (y > toD.getUTCFullYear() || (y === toD.getUTCFullYear() && m >= toD.getUTCMonth())) {
          break;
        }
        m += 1;
        if (m > 11) { m = 0; y += 1; }
      }
      out.sort();
      break;
    }
    case "monthly": {
      let cursor = addMonthsUtc(anchor, 0);
      // Fast-forward.
      while (cursor < fromD) cursor = addMonthsUtc(cursor, 1);
      while (cursor <= toD) {
        out.push(formatYmd(cursor));
        cursor = addMonthsUtc(cursor, 1);
      }
      break;
    }
    case "custom": {
      const days = (input.customDays ?? [])
        .filter((d) => Number.isFinite(d) && d >= 1 && d <= 31)
        .sort((a, b) => a - b);
      if (days.length === 0) break;
      let y = fromD.getUTCFullYear();
      let m = fromD.getUTCMonth();
      while (true) {
        const dim = daysInMonth(y, m);
        for (const d of days) {
          const cand = new Date(Date.UTC(y, m, Math.min(d, dim)));
          if (cand >= fromD && cand <= toD) out.push(formatYmd(cand));
        }
        if (y > toD.getUTCFullYear() || (y === toD.getUTCFullYear() && m >= toD.getUTCMonth())) {
          break;
        }
        m += 1;
        if (m > 11) { m = 0; y += 1; }
      }
      break;
    }
  }

  return out;
}
