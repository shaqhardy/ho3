import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push/send";
import { buildStatementAvailablePush } from "@/lib/push/notifications";

type Book = "personal" | "business" | "nonprofit";

interface PlaidItemLike {
  id?: string;
  user_id?: string;
  plaid_access_token: string;
  plaid_item_id: string;
  institution_name?: string | null;
}

interface PlaidListStatement {
  statement_id: string;
  period_start?: string | null;
  period_end?: string | null;
  opening_balance?: number | null;
  closing_balance?: number | null;
  total_debits?: number | null;
  total_credits?: number | null;
}

interface PlaidListAccount {
  account_id: string;
  statements?: PlaidListStatement[];
}

interface PlaidListResponse {
  accounts?: PlaidListAccount[];
  error_code?: string;
}

const BUCKET = "documents";

function plaidBaseUrl(): string {
  return process.env.PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : "https://sandbox.plaid.com";
}

async function usersForBook(
  admin: SupabaseClient,
  book: Book,
  cache: Map<Book, string[]>
): Promise<string[]> {
  const cached = cache.get(book);
  if (cached) return cached;
  const { data } = await admin.from("profiles").select("id, allowed_books");
  const ids = ((data ?? []) as { id: string; allowed_books: Book[] | null }[])
    .filter((r) => (r.allowed_books ?? []).includes(book))
    .map((r) => r.id);
  cache.set(book, ids);
  return ids;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pulls statements from Plaid per item, downloads any new PDFs, stores them in
 * the private "documents" bucket, inserts rows into account_statements, and
 * fires a push notification to users who can access each account's book.
 */
export async function syncStatementsForItems(
  adminClient: SupabaseClient,
  items: PlaidItemLike[]
): Promise<{ synced: number; downloaded: number }> {
  const baseUrl = plaidBaseUrl();
  let synced = 0;
  let downloaded = 0;

  const bookUserCache = new Map<Book, string[]>();

  for (const item of items) {
    const listRes = await fetch(`${baseUrl}/statements/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token: item.plaid_access_token,
      }),
    });

    const listData = (await listRes.json()) as PlaidListResponse;

    if (!listRes.ok) {
      if (
        listData?.error_code === "PRODUCTS_NOT_SUPPORTED" ||
        listData?.error_code === "PRODUCT_NOT_READY"
      ) {
        continue;
      }
      console.error("[statements] list error", listData);
      continue;
    }

    for (const acct of listData.accounts ?? []) {
      // Map Plaid account_id -> internal accounts row.
      const { data: accountRow } = await adminClient
        .from("accounts")
        .select("id, book, name")
        .eq("plaid_account_id", acct.account_id)
        .maybeSingle();

      if (!accountRow) continue;

      for (const stmt of acct.statements ?? []) {
        if (!stmt.statement_id) continue;

        synced++;

        const { data: existing } = await adminClient
          .from("account_statements")
          .select("id")
          .eq("plaid_statement_id", stmt.statement_id)
          .maybeSingle();

        if (existing) continue;

        // Download PDF.
        const dlRes = await fetch(`${baseUrl}/statements/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: process.env.PLAID_CLIENT_ID,
            secret: process.env.PLAID_SECRET,
            access_token: item.plaid_access_token,
            statement_id: stmt.statement_id,
          }),
        });

        if (!dlRes.ok) {
          const errText = await dlRes.text().catch(() => "");
          console.error(
            "[statements] download error",
            stmt.statement_id,
            errText
          );
          continue;
        }

        const ab = await dlRes.arrayBuffer();
        const bytes = new Uint8Array(ab);
        const byteSize = bytes.byteLength;

        const storagePath = `account-statements/${accountRow.id}/${stmt.statement_id}.pdf`;

        const uploadRes = await adminClient.storage
          .from(BUCKET)
          .upload(storagePath, bytes, {
            contentType: "application/pdf",
            upsert: true,
          });

        if (uploadRes.error) {
          console.error(
            "[statements] storage upload failed",
            stmt.statement_id,
            uploadRes.error
          );
          continue;
        }

        const nowIso = new Date().toISOString();
        const periodStart = stmt.period_start ?? null;
        const periodEnd = stmt.period_end ?? null;

        const { error: insErr } = await adminClient
          .from("account_statements")
          .insert({
            account_id: accountRow.id,
            plaid_statement_id: stmt.statement_id,
            period_start: periodStart,
            period_end: periodEnd,
            opening_balance: numOrNull(stmt.opening_balance),
            closing_balance: numOrNull(stmt.closing_balance),
            total_debits: numOrNull(stmt.total_debits),
            total_credits: numOrNull(stmt.total_credits),
            storage_path: storagePath,
            byte_size: byteSize,
            downloaded_at: nowIso,
          });

        if (insErr) {
          console.error(
            "[statements] insert row failed",
            stmt.statement_id,
            insErr
          );
          continue;
        }

        downloaded++;

        // Push notification per new statement.
        if (periodEnd) {
          const recipients = await usersForBook(
            adminClient,
            accountRow.book as Book,
            bookUserCache
          );
          const payload = buildStatementAvailablePush({
            account_id: accountRow.id,
            account_name: accountRow.name,
            period_end: periodEnd,
          });
          for (const uid of recipients) {
            await sendPushToUser(
              uid,
              payload,
              `statement_${accountRow.id}_${stmt.statement_id}`,
              "statement_available"
            );
          }
        }
      }
    }
  }

  return { synced, downloaded };
}
