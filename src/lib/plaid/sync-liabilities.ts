import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push/send";
import {
  buildDebtMilestonePush,
  buildPlaidReconnectPush,
} from "@/lib/push/notifications";

type Book = "personal" | "business" | "nonprofit";

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

interface MilestonePrefs {
  user_id: string;
  debt_milestone_paid_off: boolean;
  debt_milestone_halfway: boolean;
  debt_milestone_custom: boolean;
  plaid_reconnect_needed: boolean;
}

async function loadMilestonePrefs(
  admin: SupabaseClient
): Promise<Map<string, MilestonePrefs>> {
  const { data } = await admin
    .from("notification_preferences")
    .select(
      "user_id, debt_milestone_paid_off, debt_milestone_halfway, debt_milestone_custom, plaid_reconnect_needed"
    );
  const map = new Map<string, MilestonePrefs>();
  for (const row of (data ?? []) as MilestonePrefs[]) {
    map.set(row.user_id, row);
  }
  return map;
}

async function usersForBook(
  admin: SupabaseClient,
  book: Book
): Promise<string[]> {
  const { data } = await admin
    .from("profiles")
    .select("id, allowed_books");
  return ((data ?? []) as { id: string; allowed_books: Book[] | null }[])
    .filter((r) => (r.allowed_books ?? []).includes(book))
    .map((r) => r.id);
}

async function handlePlaidReconnect(
  admin: SupabaseClient,
  item: {
    id: string;
    user_id: string;
    plaid_item_id: string;
    institution_name: string | null;
  },
  errorCode: string,
  prefsByUser: Map<string, MilestonePrefs>
) {
  if (errorCode !== "ITEM_LOGIN_REQUIRED") return;
  const nowIso = new Date().toISOString();
  await admin
    .from("plaid_items")
    .update({
      needs_reauth: true,
      last_error: errorCode,
      last_error_at: nowIso,
    })
    .eq("id", item.id);

  const { data: latest } = await admin
    .from("notifications_log")
    .select("id, created_at")
    .eq("user_id", item.user_id)
    .eq("alert_type", "plaid_reconnect")
    .like("dedup_key", `reconnect_${item.id}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.created_at) {
    const ageMs = Date.now() - new Date(latest.created_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) return;
  }

  const prefs = prefsByUser.get(item.user_id);
  if (prefs && prefs.plaid_reconnect_needed === false) return;

  const payload = buildPlaidReconnectPush({
    id: item.id,
    plaid_item_id: item.plaid_item_id,
    institution_name: item.institution_name,
  });
  const day = new Date().toISOString().slice(0, 10);
  await sendPushToUser(
    item.user_id,
    payload,
    `reconnect_${item.id}_${day}`,
    "plaid_reconnect"
  );
}

async function fireDebtMilestoneIfNeeded(
  admin: SupabaseClient,
  debt: {
    id: string;
    book: Book;
    creditor: string;
    nickname: string | null;
    current_balance: number;
    original_balance: number | null;
    custom_milestone_threshold: number | null;
  },
  prefsByUser: Map<string, MilestonePrefs>,
  bookUserCache: Map<Book, string[]>
) {
  type MilestoneKind = "paid_off" | "halfway" | "custom";

  async function getRecipients(book: Book): Promise<string[]> {
    const cached = bookUserCache.get(book);
    if (cached) return cached;
    const ids = await usersForBook(admin, book);
    bookUserCache.set(book, ids);
    return ids;
  }

  async function alreadyHit(milestone: MilestoneKind): Promise<boolean> {
    const { data } = await admin
      .from("debt_milestones_hit")
      .select("id")
      .eq("debt_id", debt.id)
      .eq("milestone", milestone)
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  async function tryFire(
    milestone: MilestoneKind,
    prefKey: keyof MilestonePrefs
  ) {
    if (await alreadyHit(milestone)) return;
    // Insert first to guard against races (unique constraint on debt_id+milestone).
    const { error: insErr } = await admin
      .from("debt_milestones_hit")
      .insert({
        debt_id: debt.id,
        milestone,
        balance_at_hit: debt.current_balance,
      });
    if (insErr) {
      // If someone else inserted in the gap, skip firing.
      return;
    }
    const recipients = await getRecipients(debt.book);
    const payload = buildDebtMilestonePush(
      {
        id: debt.id,
        creditor: debt.creditor,
        nickname: debt.nickname,
        original_balance: debt.original_balance,
        custom_milestone_threshold: debt.custom_milestone_threshold,
      },
      milestone,
      debt.current_balance
    );
    for (const uid of recipients) {
      const prefs = prefsByUser.get(uid);
      if (prefs && prefs[prefKey] === false) continue;
      await sendPushToUser(
        uid,
        payload,
        `debt_${milestone}_${debt.id}`,
        "debt_milestone"
      );
    }
  }

  if (debt.current_balance <= 0) {
    await tryFire("paid_off", "debt_milestone_paid_off");
  }
  if (
    debt.original_balance !== null &&
    Number(debt.original_balance) > 0 &&
    debt.current_balance <= Number(debt.original_balance) / 2
  ) {
    await tryFire("halfway", "debt_milestone_halfway");
  }
  if (
    debt.custom_milestone_threshold !== null &&
    debt.current_balance <= Number(debt.custom_milestone_threshold)
  ) {
    await tryFire("custom", "debt_milestone_custom");
  }
}

export async function syncLiabilities(
  adminSupabase: SupabaseClient,
  plaidItems: {
    id?: string;
    user_id?: string;
    plaid_access_token: string;
    plaid_item_id: string;
    institution_name?: string | null;
  }[]
) {
  const plaidBaseUrl =
    process.env.PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : "https://sandbox.plaid.com";

  let synced = 0;

  const prefsByUser = await loadMilestonePrefs(adminSupabase);
  const bookUserCache = new Map<Book, string[]>();

  // Ensure we have full plaid_items rows for reconnect handling.
  async function fullItem(it: (typeof plaidItems)[number]) {
    if (it.id && it.user_id) {
      return {
        id: it.id,
        user_id: it.user_id,
        plaid_item_id: it.plaid_item_id,
        institution_name: it.institution_name ?? null,
      };
    }
    const { data } = await adminSupabase
      .from("plaid_items")
      .select("id, user_id, plaid_item_id, institution_name")
      .eq("plaid_item_id", it.plaid_item_id)
      .maybeSingle();
    return data
      ? {
          id: data.id as string,
          user_id: data.user_id as string,
          plaid_item_id: data.plaid_item_id as string,
          institution_name: (data.institution_name as string | null) ?? null,
        }
      : null;
  }

  for (const item of plaidItems) {
    const response = await fetch(`${plaidBaseUrl}/liabilities/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token: item.plaid_access_token,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.error_code === "PRODUCTS_NOT_SUPPORTED") continue;
      console.error("Liabilities error:", data);
      if (data.error_code) {
        const full = await fullItem(item);
        if (full) {
          await handlePlaidReconnect(
            adminSupabase,
            full,
            String(data.error_code),
            prefsByUser
          );
        }
      }
      continue;
    }

    // Process credit card liabilities
    for (const card of data.liabilities?.credit || []) {
      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book, name")
        .eq("plaid_account_id", card.account_id)
        .single();

      if (!account) continue;

      const apr =
        card.aprs?.find(
          (a: { apr_type: string }) => a.apr_type === "purchase_apr"
        )?.apr_percentage || 0;
      const balance = Math.abs(card.last_statement_balance || 0);
      const minPayment = card.minimum_payment_amount || 0;
      const payoff = calculatePayoff(balance, apr, minPayment);

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor: account.name,
          current_balance: balance,
          apr,
          minimum_payment: minPayment,
          statement_due_date:
            card.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
          projected_payoff_months: payoff.months,
          projected_total_interest: payoff.totalInterest,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      );

      synced++;
    }

    // Process student loan liabilities
    for (const loan of data.liabilities?.student || []) {
      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book, name")
        .eq("plaid_account_id", loan.account_id)
        .single();

      if (!account) continue;

      const balance = Math.abs(
        (loan.outstanding_interest_amount || 0) +
          (loan.last_statement_balance || 0)
      );
      const apr = loan.interest_rate_percentage || 0;
      const minPayment = loan.minimum_payment_amount || 0;
      const payoff = calculatePayoff(balance, apr, minPayment);

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor: loan.servicer_address?.organization || account.name,
          current_balance: balance,
          apr,
          minimum_payment: minPayment,
          statement_due_date:
            loan.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
          projected_payoff_months: payoff.months,
          projected_total_interest: payoff.totalInterest,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      );

      synced++;
    }

    // Process mortgage liabilities
    for (const mortgage of data.liabilities?.mortgage || []) {
      const { data: account } = await adminSupabase
        .from("accounts")
        .select("id, book, name")
        .eq("plaid_account_id", mortgage.account_id)
        .single();

      if (!account) continue;

      const balance = mortgage.outstanding_principal || 0;
      const apr = mortgage.interest_rate?.percentage || 0;
      const minPayment = mortgage.next_monthly_payment || 0;
      const payoff = calculatePayoff(balance, apr, minPayment);

      await adminSupabase.from("debts").upsert(
        {
          account_id: account.id,
          book: account.book,
          creditor: mortgage.servicer_address?.organization || account.name,
          current_balance: balance,
          apr,
          minimum_payment: minPayment,
          statement_due_date:
            mortgage.next_payment_due_date ||
            new Date().toISOString().split("T")[0],
          projected_payoff_months: payoff.months,
          projected_total_interest: payoff.totalInterest,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      );

      synced++;
    }
  }

  // Recalculate payoff projections for ALL debts, and fire milestone pushes.
  const { data: allDebts } = await adminSupabase
    .from("debts")
    .select(
      "id, book, creditor, nickname, current_balance, apr, minimum_payment, projected_payoff_months, projected_total_interest, original_balance, custom_milestone_threshold"
    );

  for (const debt of allDebts || []) {
    const payoff = calculatePayoff(
      Number(debt.current_balance),
      Number(debt.apr),
      Number(debt.minimum_payment)
    );

    if (
      payoff.months !== debt.projected_payoff_months ||
      Math.abs(
        payoff.totalInterest - Number(debt.projected_total_interest || 0)
      ) > 0.01
    ) {
      await adminSupabase
        .from("debts")
        .update({
          projected_payoff_months: payoff.months,
          projected_total_interest: payoff.totalInterest,
        })
        .eq("id", debt.id);
    }

    await fireDebtMilestoneIfNeeded(
      adminSupabase,
      {
        id: debt.id,
        book: debt.book as Book,
        creditor: debt.creditor,
        nickname: debt.nickname ?? null,
        current_balance: Number(debt.current_balance),
        original_balance:
          debt.original_balance === null || debt.original_balance === undefined
            ? null
            : Number(debt.original_balance),
        custom_milestone_threshold:
          debt.custom_milestone_threshold === null ||
          debt.custom_milestone_threshold === undefined
            ? null
            : Number(debt.custom_milestone_threshold),
      },
      prefsByUser,
      bookUserCache
    );
  }

  return synced;
}
