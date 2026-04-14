import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncLiabilities } from "@/lib/plaid/sync-liabilities";
import { autoMatchBillForTransaction } from "@/lib/bills/auto-match";
import { sendPushToUser } from "@/lib/push/send";
import {
  buildLargeTxnPush,
  buildIncomePush,
  buildLowBalancePush,
  buildBillPaidPush,
  buildPlaidReconnectPush,
} from "@/lib/push/notifications";

// Node runtime — web-push uses node crypto (used downstream).
export const runtime = "nodejs";

type Book = "personal" | "business" | "nonprofit";

interface PrefsShape {
  user_id: string;
  large_transactions: boolean;
  large_txn_threshold_personal: number | string;
  large_txn_threshold_business: number | string;
  large_txn_threshold_nonprofit: number | string;
  income_alerts: boolean;
  low_balance_warning: boolean;
  bill_paid_confirmation: boolean;
  plaid_reconnect_needed: boolean;
}

function thresholdForBook(prefs: PrefsShape, book: Book): number {
  if (book === "business") return Number(prefs.large_txn_threshold_business);
  if (book === "nonprofit") return Number(prefs.large_txn_threshold_nonprofit);
  return Number(prefs.large_txn_threshold_personal);
}

async function getPrefsByUser(
  admin: SupabaseClient
): Promise<Map<string, PrefsShape>> {
  const { data } = await admin
    .from("notification_preferences")
    .select(
      "user_id, large_transactions, large_txn_threshold_personal, large_txn_threshold_business, large_txn_threshold_nonprofit, income_alerts, low_balance_warning, bill_paid_confirmation, plaid_reconnect_needed"
    );
  const map = new Map<string, PrefsShape>();
  for (const row of (data ?? []) as PrefsShape[]) {
    map.set(row.user_id, row);
  }
  return map;
}

async function eligibleUserIdsForBook(
  admin: SupabaseClient,
  book: Book
): Promise<string[]> {
  const { data } = await admin
    .from("profiles")
    .select("id, allowed_books");
  const rows = (data ?? []) as { id: string; allowed_books: Book[] | null }[];
  return rows
    .filter((r) => (r.allowed_books ?? []).includes(book))
    .map((r) => r.id);
}

async function handlePlaidError(
  admin: SupabaseClient,
  item: { id: string; user_id: string; plaid_item_id: string; institution_name: string | null },
  errorCode: string,
  prefsByUser: Map<string, PrefsShape>
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

  // Allow re-fire after 24h: check latest fire.
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
  // Include timestamp bucket (rounded to day) so dedup allows ~daily re-fire.
  const dayBucket = new Date().toISOString().slice(0, 10);
  await sendPushToUser(
    item.user_id,
    payload,
    `reconnect_${item.id}_${dayBucket}`,
    "plaid_reconnect"
  );
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get all Plaid items
  const { data: plaidItemsData } = await adminSupabase
    .from("plaid_items")
    .select(
      "id, user_id, plaid_item_id, plaid_access_token, institution_name, cursor"
    );
  const plaidItems = (plaidItemsData ?? []) as {
    id: string;
    user_id: string;
    plaid_item_id: string;
    plaid_access_token: string;
    institution_name: string | null;
    cursor: string | null;
  }[];

  if (!plaidItems.length) {
    return NextResponse.json({ error: "No Plaid items found" }, { status: 404 });
  }

  const plaidBaseUrl =
    process.env.PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : "https://sandbox.plaid.com";

  // Load all users' preferences once — sync processes every item for every user.
  const prefsByUser = await getPrefsByUser(adminSupabase);

  // Cache profiles-for-book lookups.
  const bookUserCache = new Map<Book, string[]>();
  async function usersForBook(book: Book): Promise<string[]> {
    const cached = bookUserCache.get(book);
    if (cached) return cached;
    const ids = await eligibleUserIdsForBook(adminSupabase, book);
    bookUserCache.set(book, ids);
    return ids;
  }

  let totalAdded = 0;
  let totalModified = 0;

  for (const item of plaidItems) {
    // Sync transactions using cursor-based pagination
    let hasMore = true;
    let cursor = item.cursor || undefined;

    while (hasMore) {
      const syncResponse = await fetch(`${plaidBaseUrl}/transactions/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.PLAID_CLIENT_ID,
          secret: process.env.PLAID_SECRET,
          access_token: item.plaid_access_token,
          cursor,
          count: 500,
        }),
      });

      const syncData = await syncResponse.json();

      if (!syncResponse.ok) {
        console.error("Plaid sync error:", syncData);
        if (syncData?.error_code) {
          await handlePlaidError(
            adminSupabase,
            item,
            String(syncData.error_code),
            prefsByUser
          );
        }
        break;
      }

      // Get account-to-book mapping for this item, plus account ids / metadata.
      const { data: itemAccounts } = await adminSupabase
        .from("accounts")
        .select(
          "id, plaid_account_id, book, name, current_balance, available_balance, low_balance_threshold, low_balance_alert_state"
        )
        .eq("plaid_item_id", item.plaid_item_id);

      type AccountRow = {
        id: string;
        plaid_account_id: string;
        book: Book;
        name: string;
        current_balance: number | string;
        available_balance: number | string | null;
        low_balance_threshold: number | string | null;
        low_balance_alert_state: "above" | "below" | null;
      };

      const accountByPlaidId = new Map<string, AccountRow>();
      for (const a of (itemAccounts ?? []) as AccountRow[]) {
        accountByPlaidId.set(a.plaid_account_id, a);
      }

      // Process added transactions
      for (const txn of syncData.added || []) {
        const acct = accountByPlaidId.get(txn.account_id);
        const book: Book = (acct?.book as Book) || "personal";
        const accountId = acct?.id ?? null;

        // Check for auto-categorization rule
        const { data: rules } = await adminSupabase
          .from("category_rules")
          .select("category_id")
          .eq("book", book)
          .ilike("merchant_pattern", `%${txn.merchant_name || txn.name}%`)
          .limit(1);

        const categoryId = rules?.[0]?.category_id || null;

        // Plaid amounts: positive = expense leaving account, negative = income.
        const isIncome = txn.amount < 0;
        const absAmount = Math.abs(txn.amount);

        const { data: upserted } = await adminSupabase
          .from("transactions")
          .upsert(
            {
              plaid_transaction_id: txn.transaction_id,
              account_id: accountId,
              book,
              date: txn.date,
              amount: absAmount,
              merchant: txn.merchant_name || txn.name,
              description: txn.name,
              category_id: categoryId,
              is_income: isIncome,
            },
            { onConflict: "plaid_transaction_id" }
          )
          .select("id")
          .maybeSingle();

        const txnId = upserted?.id ?? null;

        // Auto-create category rule if merchant is new
        if (categoryId && txn.merchant_name) {
          const { data: existingRule } = await adminSupabase
            .from("category_rules")
            .select("id")
            .eq("merchant_pattern", txn.merchant_name)
            .eq("book", book)
            .limit(1);

          if (!existingRule?.length) {
            await adminSupabase.from("category_rules").insert({
              merchant_pattern: txn.merchant_name,
              category_id: categoryId,
              book,
            });
          }
        }

        // Fire notifications to any user with access to this book.
        const recipients = await usersForBook(book);
        const categoryName = categoryId
          ? (
              await adminSupabase
                .from("categories")
                .select("name")
                .eq("id", categoryId)
                .maybeSingle()
            ).data?.name ?? null
          : null;

        for (const uid of recipients) {
          const prefs = prefsByUser.get(uid);

          if (isIncome) {
            if (prefs?.income_alerts !== false) {
              const dedupId = txnId ?? txn.transaction_id;
              const payload = buildIncomePush(
                {
                  id: dedupId,
                  amount: absAmount,
                  merchant: txn.merchant_name,
                  description: txn.name,
                  book,
                },
                acct ? { name: acct.name } : null
              );
              await sendPushToUser(
                uid,
                payload,
                `income_${dedupId}`,
                "income"
              );
            }
          } else {
            const threshold = thresholdForBook(
              prefs ?? ({
                user_id: uid,
                large_transactions: false,
                large_txn_threshold_personal: 100,
                large_txn_threshold_business: 250,
                large_txn_threshold_nonprofit: 250,
                income_alerts: true,
                low_balance_warning: true,
                bill_paid_confirmation: true,
                plaid_reconnect_needed: true,
              } as PrefsShape),
              book
            );
            if (
              prefs?.large_transactions === true &&
              absAmount >= threshold
            ) {
              const dedupId = txnId ?? txn.transaction_id;
              const payload = buildLargeTxnPush(
                {
                  id: dedupId,
                  amount: absAmount,
                  merchant: txn.merchant_name,
                  description: txn.name,
                  book,
                  date: txn.date,
                },
                acct ? { id: acct.id, name: acct.name } : null,
                categoryName ? { name: categoryName } : null
              );
              await sendPushToUser(
                uid,
                payload,
                `large_txn_${dedupId}`,
                "large_txn"
              );
            }
          }
        }

        // Bill-paid auto-match: insert bill_payments, advance recurring due,
        // fire push notification. Handles variable bills via typical_amount.
        if (txnId) {
          const matched = await autoMatchBillForTransaction(
            adminSupabase,
            {
              id: txnId,
              date: txn.date,
              amount: absAmount,
              merchant: txn.merchant_name || txn.name,
              account_id: accountId,
            },
            book,
            isIncome
          );
          if (matched) {
            const { data: afterAcct } = await adminSupabase
              .from("accounts")
              .select("current_balance, available_balance")
              .eq("id", accountId)
              .maybeSingle();
            const newBalance = afterAcct
              ? Number(
                  afterAcct.available_balance ??
                    afterAcct.current_balance ??
                    0
                )
              : null;
            for (const uid of recipients) {
              const prefs = prefsByUser.get(uid);
              if (prefs?.bill_paid_confirmation === false) continue;
              const payload = buildBillPaidPush(
                {
                  id: matched.id,
                  name: matched.name,
                  amount: matched.amount,
                  book,
                },
                { id: txnId },
                newBalance
              );
              await sendPushToUser(
                uid,
                payload,
                `bill_paid_${matched.id}_${matched.due_date_period}`,
                "bill_paid"
              );
            }
          }
        }
      }

      // Process modified transactions
      for (const txn of syncData.modified || []) {
        await adminSupabase
          .from("transactions")
          .update({
            amount: Math.abs(txn.amount),
            merchant: txn.merchant_name || txn.name,
            description: txn.name,
            date: txn.date,
            is_income: txn.amount < 0,
          })
          .eq("plaid_transaction_id", txn.transaction_id);
      }

      // Process removed transactions
      for (const txn of syncData.removed || []) {
        await adminSupabase
          .from("transactions")
          .delete()
          .eq("plaid_transaction_id", txn.transaction_id);
      }

      totalAdded += (syncData.added || []).length;
      totalModified += (syncData.modified || []).length;

      cursor = syncData.next_cursor;
      hasMore = syncData.has_more;

      // Update cursor on the Plaid item
      await adminSupabase
        .from("plaid_items")
        .update({ cursor })
        .eq("id", item.id);
    }

    // Also refresh account balances
    const balanceResponse = await fetch(`${plaidBaseUrl}/accounts/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token: item.plaid_access_token,
      }),
    });

    const balanceData = await balanceResponse.json();

    if (!balanceResponse.ok && balanceData?.error_code) {
      await handlePlaidError(
        adminSupabase,
        item,
        String(balanceData.error_code),
        prefsByUser
      );
    }

    if (balanceData.accounts) {
      for (const account of balanceData.accounts) {
        // Fetch prior row to compare thresholds for low balance.
        const { data: prior } = await adminSupabase
          .from("accounts")
          .select(
            "id, book, name, current_balance, available_balance, low_balance_threshold, low_balance_alert_state"
          )
          .eq("plaid_account_id", account.account_id)
          .maybeSingle();

        const newCurrent = Number(account.balances.current || 0);
        const newAvail =
          account.balances.available !== null &&
          account.balances.available !== undefined
            ? Number(account.balances.available)
            : null;
        const effectiveBal = newAvail ?? newCurrent;

        await adminSupabase
          .from("accounts")
          .update({
            current_balance: newCurrent,
            available_balance: newAvail,
            last_synced_at: new Date().toISOString(),
          })
          .eq("plaid_account_id", account.account_id);

        if (!prior) continue;

        const threshold =
          prior.low_balance_threshold === null ||
          prior.low_balance_threshold === undefined
            ? 200
            : Number(prior.low_balance_threshold);
        const state = (prior.low_balance_alert_state ?? "above") as
          | "above"
          | "below";

        // Hysteresis to prevent flapping.
        let nextState: "above" | "below" | null = null;
        let fire = false;
        if (effectiveBal < threshold && state === "above") {
          fire = true;
          nextState = "below";
        } else if (effectiveBal > threshold * 1.1 && state === "below") {
          nextState = "above";
        }

        if (nextState && nextState !== state) {
          await adminSupabase
            .from("accounts")
            .update({ low_balance_alert_state: nextState })
            .eq("id", prior.id);
        }

        if (fire) {
          const recipients = await usersForBook(prior.book as Book);
          const payload = buildLowBalancePush({
            id: prior.id,
            name: prior.name,
            current_balance: newCurrent,
            available_balance: newAvail,
            low_balance_threshold: threshold,
          });
          // Dedup key includes date so we allow re-alert after recovery + re-drop on another day.
          const today = new Date().toISOString().slice(0, 10);
          for (const uid of recipients) {
            const prefs = prefsByUser.get(uid);
            if (prefs?.low_balance_warning === false) continue;
            await sendPushToUser(
              uid,
              payload,
              `low_balance_${prior.id}_${today}`,
              "low_balance"
            );
          }
        }
      }
    }
  }

  // Sync liabilities and recalculate payoff projections (also fires milestone pushes).
  const liabilitiesSynced = await syncLiabilities(adminSupabase, plaidItems);

  return NextResponse.json({
    success: true,
    added: totalAdded,
    modified: totalModified,
    liabilities_synced: liabilitiesSynced,
  });
}

// ---- Date helpers -----------------------------------------------------------

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((ta - tb) / (24 * 60 * 60 * 1000));
}
