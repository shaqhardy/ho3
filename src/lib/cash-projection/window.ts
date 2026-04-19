export type CashWindow = "month" | "quarter" | "6mo" | "9mo" | "year" | "ytd";

export const CASH_WINDOWS: readonly CashWindow[] = [
  "month",
  "quarter",
  "6mo",
  "9mo",
  "year",
  "ytd",
] as const;

export function windowLabel(w: CashWindow): string {
  switch (w) {
    case "month":
      return "Next 30 days";
    case "quarter":
      return "Next 90 days";
    case "6mo":
      return "Next 6 months";
    case "9mo":
      return "Next 9 months";
    case "year":
      return "Next 12 months";
    case "ytd":
      return "Year to date";
  }
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

function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  return formatYmd(new Date(d.getTime() + days * 86_400_000));
}

/**
 * Resolve the ISO-date bounds for a window. Rolling forward from today,
 * except YTD which is backward from today to Jan 1.
 */
export function windowBounds(w: CashWindow, todayYmd: string): {
  start: string;
  end: string;
  rolls: "forward" | "backward";
} {
  switch (w) {
    case "month":
      return { start: todayYmd, end: addDaysYmd(todayYmd, 30), rolls: "forward" };
    case "quarter":
      return { start: todayYmd, end: addDaysYmd(todayYmd, 90), rolls: "forward" };
    case "6mo":
      return { start: todayYmd, end: addDaysYmd(todayYmd, 180), rolls: "forward" };
    case "9mo":
      return { start: todayYmd, end: addDaysYmd(todayYmd, 270), rolls: "forward" };
    case "year":
      return { start: todayYmd, end: addDaysYmd(todayYmd, 365), rolls: "forward" };
    case "ytd": {
      const [y] = todayYmd.split("-");
      return { start: `${y}-01-01`, end: todayYmd, rolls: "backward" };
    }
  }
}
