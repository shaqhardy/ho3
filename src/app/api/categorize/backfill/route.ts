import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";
import {
  categorizeBatch,
  type CategorizeInputTxn,
  type CategoryHint,
} from "@/lib/ai/categorize";
import { fetchAllPaginated } from "@/lib/supabase/paginate";

export const runtime = "nodejs";
// Long-running; disable static optimization & default edge body buffering.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 50;

interface TxnRow {
  id: string;
  book: Book;
  merchant: string | null;
  description: string | null;
  amount: number | string;
  date: string;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  is_income: boolean;
  category_id: string | null;
  categories: { name: string } | null;
}

/**
 * POST /api/categorize/backfill
 *
 * Pulls every transaction whose category is null OR whose category name is
 * literally "Other" and tries to assign a better category. Per batch:
 *   1. category_rules (merchant match) gets first crack.
 *   2. Whatever's left goes to Claude via categorizeBatch().
 *
 * Streams NDJSON progress lines so the UI can render a live counter.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Target rows: category_id null, OR current category name is "Other".
  // Paginated — a backfill run commonly sweeps >1000 stale rows, and
  // missing rows here means they stay uncategorized forever.
  const uncat = await fetchAllPaginated<TxnRow>((from, to) =>
    admin
      .from("transactions")
      .select(
        "id, book, merchant, description, amount, date, pfc_primary, pfc_detailed, is_income, category_id, categories(name)"
      )
      .is("category_id", null)
      .order("date", { ascending: false })
      .range(from, to)
  );

  // "Other" categories — fetch ids so we can filter transactions by them.
  const { data: otherCats } = await admin
    .from("categories")
    .select("id")
    .eq("name", "Other");
  const otherIds = ((otherCats ?? []) as { id: string }[]).map((c) => c.id);

  let otherTxns: TxnRow[] = [];
  if (otherIds.length > 0) {
    otherTxns = await fetchAllPaginated<TxnRow>((from, to) =>
      admin
        .from("transactions")
        .select(
          "id, book, merchant, description, amount, date, pfc_primary, pfc_detailed, is_income, category_id, categories(name)"
        )
        .in("category_id", otherIds)
        .order("date", { ascending: false })
        .range(from, to)
    );
  }

  const all: TxnRow[] = [...uncat, ...otherTxns];
  // Dedupe
  const byId = new Map<string, TxnRow>();
  for (const r of all) byId.set(r.id, r);
  const rows = Array.from(byId.values());

  // Pre-load rules + categories for every book we'll touch.
  const booksInvolved = Array.from(new Set(rows.map((r) => r.book))) as Book[];
  const rulesByBook = new Map<
    Book,
    { merchant_pattern: string; category_id: string }[]
  >();
  const categoriesByBook: Record<Book, CategoryHint[]> = {
    personal: [],
    business: [],
    nonprofit: [],
  };
  for (const book of booksInvolved) {
    const [{ data: rules }, { data: cats }] = await Promise.all([
      admin
        .from("category_rules")
        .select("merchant_pattern, category_id")
        .eq("book", book),
      admin
        .from("categories")
        .select("id, name")
        .eq("book", book)
        .eq("is_archived", false),
    ]);
    rulesByBook.set(
      book,
      ((rules ?? []) as {
        merchant_pattern: string;
        category_id: string;
      }[]).filter((r) => r.merchant_pattern)
    );
    categoriesByBook[book] = ((cats ?? []) as CategoryHint[]).map((c) => ({
      id: c.id,
      name: c.name,
    }));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const totals = {
        total: rows.length,
        processed: 0,
        rule_applied: 0,
        ai_applied: 0,
        skipped: 0,
      };

      emit({ type: "start", total: totals.total });

      // Work in chunks of 50 to keep memory + Claude call sizes sane.
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);

        // Phase 1: rule match.
        const leftoverForAi: TxnRow[] = [];
        for (const r of batch) {
          const merchant = (r.merchant || r.description || "").toLowerCase();
          const rules = rulesByBook.get(r.book) ?? [];
          let matchedId: string | null = null;
          for (const rule of rules) {
            const pat = rule.merchant_pattern.toLowerCase();
            if (!pat) continue;
            if (merchant.includes(pat) || pat.includes(merchant)) {
              matchedId = rule.category_id;
              break;
            }
          }
          if (matchedId && matchedId !== r.category_id) {
            const { error } = await admin
              .from("transactions")
              .update({ category_id: matchedId })
              .eq("id", r.id);
            if (!error) totals.rule_applied += 1;
            else leftoverForAi.push(r);
          } else if (!matchedId) {
            leftoverForAi.push(r);
          }
          totals.processed += 1;
        }

        // Phase 2: Claude for anything left.
        if (leftoverForAi.length > 0) {
          const claudeInputs: CategorizeInputTxn[] = leftoverForAi.map((r) => ({
            id: r.id,
            book: r.book,
            merchant: r.merchant,
            description: r.description,
            amount: r.amount,
            date: r.date,
            pfc_primary: r.pfc_primary,
            pfc_detailed: r.pfc_detailed,
            is_income: r.is_income,
          }));
          const results = await categorizeBatch(
            claudeInputs,
            categoriesByBook
          );
          const nowIso = new Date().toISOString();
          for (const r of leftoverForAi) {
            const hit = results.get(r.id);
            if (!hit) {
              totals.skipped += 1;
              continue;
            }
            const { error } = await admin
              .from("transactions")
              .update({
                category_id: hit.categoryId,
                ai_categorized: true,
                ai_categorized_at: nowIso,
                ai_confidence: hit.confidence,
                ai_model: hit.model,
              })
              .eq("id", r.id);
            if (!error) totals.ai_applied += 1;
            else totals.skipped += 1;
          }
        }

        emit({ type: "progress", ...totals });
      }

      emit({ type: "done", ...totals });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
