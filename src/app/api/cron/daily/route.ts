import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/send";
import {
  buildSubscriptionRenewalPush,
  buildBillNotPaidPush,
  buildCategoryOverspendPush,
  buildGoalHitPush,
} from "@/lib/push/notifications";
import { currentPeriodRange } from "@/lib/budgets/compute";
import { generateTuneUpSuggestions } from "@/lib/budgets/suggestions";
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
  subscription_renewal_warning: boolean;
  bill_not_paid_alert: boolean;
  category_overspend: boolean;
  goal_hit: boolean;
}

interface BillRow {
  id: string;
  book: Book;
  name: string;
  amount: number | string;
  due_date: string;
  status: string;
  priority_tier: string;
  account_id: string | null;
}

interface SubscriptionRow {
  id: string;
  book: Book;
  name: string;
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
  type: string;
  current_balance: number | string;
  available_balance: number | string | null;
}

interface TransactionRow {
  book: Book;
  amount: number | string;
  is_income: boolean;
  date: string;
  category_id?: string | null;
}

// ---- Date helpers (Pacific time) --------------------------------------------

const PACIFIC_TZ = "America/Los_Angeles";

function pacificYmd(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

function addDaysYmd(ymd: string, days: number): string {
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

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const subWindowStart = addDaysYmd(today, 1); // +1
  const subWindowEnd = addDaysYmd(today, 3); // +3
  const yesterday = addDaysYmd(today, -1);

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
      "user_id, bills_due, shortfall_warning, plaid_sync_errors, daily_summary, subscription_renewal_warning, bill_not_paid_alert, category_overspend, goal_hit"
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
      subscription_renewal_warning: true,
      bill_not_paid_alert: true,
      category_overspend: false,
      goal_hit: false,
    };
    const allowed = profile.allowed_books ?? [];
    if (allowed.length === 0) continue;

    try {
      // 1. Bills due tomorrow
      if (prefs.bills_due) {
        const { data: bills } = await supabase
          .from("bills")
          .select(
            "id, book, name, amount, due_date, status, priority_tier, account_id"
          )
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
              .select("book, type, current_balance, available_balance")
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

        // Shortfall check: start from spendable cash only. Adding credit-card
        // or loan balances here would mask real shortfalls (their balances are
        // money owed, not money held).
        const startCash = accounts
          .filter((a) => a.type === "depository")
          .reduce(
            (sum, a) =>
              sum + Number(a.available_balance ?? a.current_balance ?? 0),
            0
          );

        let running = startCash;
        let firstShortfallDate: string | null = null;
        let firstShortfallAmount = 0;
        for (let i = 0; i <= 14; i++) {
          const day = addDaysYmd(today, i);
          for (const inc of incomeRows) {
            if (inc.date === day) running += Number(inc.amount);
          }
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
            .select("book, type, current_balance, available_balance")
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

        // Daily summary cash: depository only. Never include credit/loan.
        const totalCash = accounts
          .filter((a) => a.type === "depository")
          .reduce(
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

      // 4. Subscription renewal warning (1–3 days ahead, aggregated)
      if (prefs.subscription_renewal_warning) {
        const { data: subs } = await supabase
          .from("subscriptions")
          .select("id, book, name, amount, next_charge_date, is_active")
          .in("book", allowed)
          .eq("is_active", true)
          .gte("next_charge_date", subWindowStart)
          .lte("next_charge_date", subWindowEnd);
        const rows = (subs ?? []) as SubscriptionRow[];
        if (rows.length > 0) {
          // Choose the shortest daysAhead for the message phrasing.
          let minDaysAhead = 3;
          for (const s of rows) {
            for (let i = 1; i <= 3; i++) {
              if (s.next_charge_date === addDaysYmd(today, i)) {
                if (i < minDaysAhead) minDaysAhead = i;
              }
            }
          }
          const payload = buildSubscriptionRenewalPush(
            rows.map((s) => ({
              id: s.id,
              name: s.name,
              amount: Number(s.amount),
              next_charge_date: s.next_charge_date,
            })),
            minDaysAhead
          );
          await sendPushToUser(
            profile.id,
            payload,
            `sub_renewal_${profile.id}_${today}`,
            "subscription_renewal"
          );
        }
      }

      // 5. Bill NOT paid alert — bills whose due_date just passed without a match.
      if (prefs.bill_not_paid_alert) {
        const { data: overdueBills } = await supabase
          .from("bills")
          .select(
            "id, book, name, amount, due_date, status, priority_tier, account_id"
          )
          .in("book", allowed)
          .eq("status", "upcoming")
          .eq("due_date", yesterday);

        for (const bill of (overdueBills ?? []) as BillRow[]) {
          // Look for a matching transaction within a 3-day window around due_date.
          const winStart = addDaysYmd(bill.due_date, -3);
          const winEnd = addDaysYmd(bill.due_date, 3);
          const billAmt = Number(bill.amount);
          const tolerance = Math.max(billAmt * 0.01, 0.01);

          let txQuery = supabase
            .from("transactions")
            .select("id, amount, date, account_id")
            .eq("book", bill.book)
            .eq("is_income", false)
            .gte("date", winStart)
            .lte("date", winEnd)
            .gte("amount", billAmt - tolerance)
            .lte("amount", billAmt + tolerance);
          if (bill.account_id) {
            txQuery = txQuery.eq("account_id", bill.account_id);
          }
          const { data: matches } = await txQuery.limit(1);

          if (matches && matches.length > 0) continue;

          const payload = buildBillNotPaidPush({
            id: bill.id,
            name: bill.name,
            amount: billAmt,
            due_date: bill.due_date,
            book: bill.book,
          });
          await sendPushToUser(
            profile.id,
            payload,
            `bill_not_paid_${bill.id}_${bill.due_date}`,
            "bill_not_paid"
          );
        }
      }

      // 6. Category overspend — active budgets only, one alert per period/category.
      if (prefs.category_overspend) {
        const { data: budgets } = await supabase
          .from("budgets")
          .select(
            "id, user_id, book, name, period, period_start_date, period_end_date, is_active"
          )
          .eq("user_id", profile.id)
          .eq("is_active", true);

        for (const b of budgets ?? []) {
          if (!allowed.includes(b.book as Book)) continue;
          const range = currentPeriodRange({
            period: b.period,
            period_start_date: b.period_start_date,
            period_end_date: b.period_end_date,
          });
          const periodStart = formatISODate(range.start);
          const periodEnd = formatISODate(range.end);

          const [{ data: bcats }, { data: txs }] = await Promise.all([
            supabase
              .from("budget_categories")
              .select("id, budget_id, category_id, allocated_amount")
              .eq("budget_id", b.id),
            supabase
              .from("transactions")
              .select("amount, category_id, is_income, book, date")
              .eq("book", b.book)
              .eq("is_income", false)
              .gte("date", periodStart)
              .lte("date", periodEnd),
          ]);

          const spentByCat = new Map<string, number>();
          for (const t of (txs ?? []) as TransactionRow[]) {
            if (!t.category_id) continue;
            const amt = Math.abs(Number(t.amount));
            spentByCat.set(
              t.category_id,
              (spentByCat.get(t.category_id) ?? 0) + amt
            );
          }

          const catIds = (bcats ?? [])
            .map((c) => c.category_id)
            .filter(Boolean) as string[];
          const catNameById = new Map<string, string>();
          if (catIds.length > 0) {
            const { data: cats } = await supabase
              .from("categories")
              .select("id, name")
              .in("id", catIds);
            for (const c of cats ?? []) {
              catNameById.set(c.id as string, c.name as string);
            }
          }

          for (const bc of bcats ?? []) {
            const allocated = Number(bc.allocated_amount);
            if (!(allocated > 0)) continue;
            const spent = spentByCat.get(bc.category_id) ?? 0;
            if (spent <= allocated) continue;

            const catName =
              catNameById.get(bc.category_id) ?? "Category";
            const payload = buildCategoryOverspendPush(
              { id: bc.category_id, name: catName },
              {
                id: b.id,
                name: b.name,
                period_start_date: periodStart,
              },
              spent,
              allocated
            );
            await sendPushToUser(
              profile.id,
              payload,
              `overspend_${bc.id}_${periodStart}`,
              "category_overspend"
            );
          }
        }
      }

      // 7. Goal hit — active goals that reached their target.
      if (prefs.goal_hit) {
        const { data: goals } = await supabase
          .from("goals")
          .select(
            "id, user_id, book, name, target_amount, current_amount, status"
          )
          .eq("user_id", profile.id)
          .eq("status", "active");

        for (const g of goals ?? []) {
          if (g.book && !allowed.includes(g.book as Book)) continue;
          const target = Number(g.target_amount);
          const current = Number(g.current_amount ?? 0);
          if (!(target > 0)) continue;
          if (current < target) continue;

          await supabase
            .from("goals")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
            })
            .eq("id", g.id);

          const payload = buildGoalHitPush({
            id: g.id,
            name: g.name,
            target_amount: target,
            current_amount: current,
          });
          await sendPushToUser(
            profile.id,
            payload,
            `goal_hit_${g.id}`,
            "goal_hit"
          );
        }
      }

      processed++;
    } catch (err) {
      console.error("[cron daily] user error", profile.id, err);
    }
  }

  // End-of-period budget tune-up suggestions. Idempotent: unique constraint on
  // (budget_category_id, period_key) means daily runs don't duplicate rows.
  let tune_up: { budgets_checked: number; suggestions_created: number } = {
    budgets_checked: 0,
    suggestions_created: 0,
  };
  try {
    tune_up = await generateTuneUpSuggestions(supabase);
  } catch (err) {
    console.error("[cron daily] tune-up generation failed", err);
  }

  return NextResponse.json({ processed, tune_up });
}
