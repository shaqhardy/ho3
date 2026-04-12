import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/send";
import type { Book } from "@/lib/types";

// Ensure this runs on Node.js (web-push uses node crypto).
export const runtime = "nodejs";
// No static caching — cron always runs fresh.
export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "user";
  allowed_books: Book[];
}

interface PreferencesRow {
  user_id: string;
  bills_due: boolean;
  shortfall_warning: boolean;
  plaid_sync_errors: boolean;
  daily_summary: boolean;
}

interface BillRow {
  id: string;
  book: Book;
  name: string;
  amount: number | string;
  due_date: string;
  status: string;
  priority_tier: string;
}

interface SubscriptionRow {
  book: Book;
  amount: number | string;
  next_charge_date: string;
  is_active: boolean;
}

interface DebtRow {
  book: Book;
  minimum_payment: number | string;
  statement_due_date: string;
}

interface ProjectedIncomeRow {
  book: Book;
  date: string;
  amount: number | string;
}

interface AccountRow {
  book: Book;
  current_balance: number | string;
  available_balance: number | string | null;
}

interface TransactionRow {
  book: Book;
  amount: number | string;
  is_income: boolean;
  date: string;
}

// ---- Date helpers (Pacific time) --------------------------------------------

const PACIFIC_TZ = "America/Los_Angeles";

function pacificYmd(d: Date): string {
  // en-CA gives YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  // Parse ymd as a calendar date (treat midnight UTC to avoid TZ drift),
  // add days, then format back to YYYY-MM-DD.
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatFriendlyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(dt);
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// ---- Core --------------------------------------------------------------------

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  const today = pacificYmd(new Date());
  const tomorrow = addDaysYmd(today, 1);
  const fourteenDaysOut = addDaysYmd(today, 14);
  const weekEnd = addDaysYmd(today, 7);

  const { data: profilesData, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, allowed_books");
  if (profilesErr) {
    console.error("[cron daily] profiles query error", profilesErr);
    return NextResponse.json(
      { error: "Failed to load profiles" },
      { status: 500 }
    );
  }
  const profiles = (profilesData ?? []) as ProfileRow[];

  const { data: prefsData } = await supabase
    .from("notification_preferences")
    .select(
      "user_id, bills_due, shortfall_warning, plaid_sync_errors, daily_summary"
    );
  const prefsByUser = new Map<string, PreferencesRow>();
  for (const p of (prefsData ?? []) as PreferencesRow[]) {
    prefsByUser.set(p.user_id, p);
  }

  let processed = 0;

  for (const profile of profiles) {
    const prefs = prefsByUser.get(profile.id) ?? {
      user_id: profile.id,
      bills_due: true,
      shortfall_warning: true,
      plaid_sync_errors: true,
      daily_summary: true,
    };
    const allowed = profile.allowed_books ?? [];
    if (allowed.length === 0) continue;

    try {
      // 1. Bills due tomorrow
      if (prefs.bills_due) {
        const { data: bills } = await supabase
          .from("bills")
          .select("id, book, name, amount, due_date, status, priority_tier")
          .eq("due_date", tomorrow)
          .eq("status", "upcoming")
          .in("book", allowed);
        for (const bill of (bills ?? []) as BillRow[]) {
          const amount = Number(bill.amount);
          await sendPushToUser(
            profile.id,
            {
              title: `Bill due tomorrow: ${bill.name}`,
              body: `${fmtUsd(amount)} due ${formatFriendlyDate(
                bill.due_date
              )}`,
              url: "/plan",
              tag: `bill-${bill.id}`,
              data: { bill_id: bill.id, book: bill.book },
            },
            `bill_due_${bill.id}_${tomorrow}`,
            "bills_due"
          );
        }
      }

      // 2. Shortfall warning — 14-day forward ledger
      if (prefs.shortfall_warning) {
        const [accountsRes, billsRes, subsRes, debtsRes, incomeRes] =
          await Promise.all([
            supabase
              .from("accounts")
              .select("book, current_balance, available_balance")
              .in("book", allowed),
            supabase
              .from("bills")
              .select("book, amount, due_date, status")
              .in("book", allowed)
              .eq("status", "upcoming")
              .gte("due_date", today)
              .lte("due_date", fourteenDaysOut),
            supabase
              .from("subscriptions")
              .select("book, amount, next_charge_date, is_active")
              .in("book", allowed)
              .eq("is_active", true)
              .gte("next_charge_date", today)
              .lte("next_charge_date", fourteenDaysOut),
            supabase
              .from("debts")
              .select("book, minimum_payment, statement_due_date")
              .in("book", allowed)
              .gte("statement_due_date", today)
              .lte("statement_due_date", fourteenDaysOut),
            supabase
              .from("projected_income")
              .select("book, date, amount")
              .in("book", allowed)
              .gte("date", today)
              .lte("date", fourteenDaysOut),
          ]);

        const accounts = (accountsRes.data ?? []) as AccountRow[];
        const billsRows = (billsRes.data ?? []) as BillRow[];
        const subsRows = (subsRes.data ?? []) as SubscriptionRow[];
        const debtsRows = (debtsRes.data ?? []) as DebtRow[];
        const incomeRows = (incomeRes.data ?? []) as ProjectedIncomeRow[];

        const startCash = accounts.reduce(
          (sum, a) =>
            sum + Number(a.available_balance ?? a.current_balance ?? 0),
          0
        );

        // Walk day by day and track running balance. Flag first shortfall.
        let running = startCash;
        let firstShortfallDate: string | null = null;
        let firstShortfallAmount = 0;
        for (let i = 0; i <= 14; i++) {
          const day = addDaysYmd(today, i);
          // income first
          for (const inc of incomeRows) {
            if (inc.date === day) running += Number(inc.amount);
          }
          // then bills, subs, debt minimums
          for (const b of billsRows) {
            if (b.due_date === day) running -= Number(b.amount);
          }
          for (const s of subsRows) {
            if (s.next_charge_date === day) running -= Number(s.amount);
          }
          for (const d of debtsRows) {
            if (d.statement_due_date === day)
              running -= Number(d.minimum_payment);
          }
          if (running < 0 && firstShortfallDate === null) {
            firstShortfallDate = day;
            firstShortfallAmount = Math.abs(running);
          }
        }

        if (firstShortfallDate) {
          await sendPushToUser(
            profile.id,
            {
              title: "Shortfall ahead",
              body: `You'll be ${fmtUsd(
                firstShortfallAmount
              )} short on ${formatFriendlyDate(firstShortfallDate)}.`,
              url: "/plan",
              tag: "ho3-shortfall",
            },
            `shortfall_${profile.id}_${today}`,
            "shortfall_warning"
          );
        }
      }

      // 3. Daily summary
      if (prefs.daily_summary) {
        const [upcomingBillsRes, accountsRes, txRes] = await Promise.all([
          supabase
            .from("bills")
            .select("id, amount, due_date, status")
            .in("book", allowed)
            .eq("status", "upcoming")
            .gte("due_date", today)
            .lte("due_date", weekEnd),
          supabase
            .from("accounts")
            .select("book, current_balance, available_balance")
            .in("book", allowed),
          supabase
            .from("transactions")
            .select("book, amount, is_income, date")
            .in("book", allowed)
            .gte("date", today.slice(0, 7) + "-01")
            .lte("date", today),
        ]);

        const upcomingBills = (upcomingBillsRes.data ?? []) as BillRow[];
        const accounts = (accountsRes.data ?? []) as AccountRow[];
        const tx = (txRes.data ?? []) as TransactionRow[];

        const totalCash = accounts.reduce(
          (s, a) =>
            s + Number(a.available_balance ?? a.current_balance ?? 0),
          0
        );
        let mtdIncome = 0;
        let mtdExpense = 0;
        for (const t of tx) {
          const amt = Number(t.amount);
          if (t.is_income) mtdIncome += amt;
          else mtdExpense += amt;
        }
        const mtdNet = mtdIncome - mtdExpense;
        const netLabel = mtdNet >= 0 ? "surplus" : "deficit";

        await sendPushToUser(
          profile.id,
          {
            title: "HO3 daily summary",
            body: `${upcomingBills.length} bill${
              upcomingBills.length === 1 ? "" : "s"
            } this week. Cash: ${fmtUsd(totalCash)}. MTD ${netLabel}: ${fmtUsd(
              Math.abs(mtdNet)
            )}.`,
            url: "/overview",
            tag: "ho3-daily-summary",
          },
          `summary_${profile.id}_${today}`,
          "daily_summary"
        );
      }

      processed++;
    } catch (err) {
      console.error("[cron daily] user error", profile.id, err);
    }
  }

  return NextResponse.json({ processed });
}
