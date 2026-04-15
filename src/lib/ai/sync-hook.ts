import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book } from "@/lib/types";
import {
  categorizeBatch,
  type CategorizeInputTxn,
  type CategoryHint,
} from "@/lib/ai/categorize";

/**
 * Rule + AI categorization for a known list of transaction ids.
 *
 * Used by both the sync-batch API and (eventually) the Plaid sync route.
 * Logic:
 *   1. Load the target rows. Skip anything that already has a category_id.
 *   2. Apply category_rules (merchant_pattern match) first — manual rules win.
 *   3. Whatever remains goes to Claude via categorizeBatch().
 *   4. Write category_id + ai_* metadata back to transactions.
 */
export interface AiSyncStats {
  considered: number;
  rule_applied: number;
  ai_applied: number;
  skipped: number;
}

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
}

export async function aiCategorizeFreshTxns(
  admin: SupabaseClient,
  txnIds: string[]
): Promise<AiSyncStats> {
  const stats: AiSyncStats = {
    considered: 0,
    rule_applied: 0,
    ai_applied: 0,
    skipped: 0,
  };
  if (txnIds.length === 0) return stats;

  const { data: rawRows } = await admin
    .from("transactions")
    .select(
      "id, book, merchant, description, amount, date, pfc_primary, pfc_detailed, is_income, category_id"
    )
    .in("id", txnIds);

  const rows = (rawRows ?? []) as TxnRow[];
  stats.considered = rows.length;

  // Already categorized? leave them alone.
  const pending = rows.filter((r) => !r.category_id);

  // --- Phase 1: apply category rules (merchant exact/substring) ---------
  const books = Array.from(new Set(pending.map((r) => r.book))) as Book[];
  const rulesByBook = new Map<
    Book,
    { merchant_pattern: string; category_id: string }[]
  >();
  for (const book of books) {
    const { data } = await admin
      .from("category_rules")
      .select("merchant_pattern, category_id")
      .eq("book", book);
    rulesByBook.set(
      book,
      ((data ?? []) as { merchant_pattern: string; category_id: string }[])
        .filter((r) => r.merchant_pattern)
    );
  }

  const aiCandidates: TxnRow[] = [];
  for (const r of pending) {
    const merchant = (r.merchant || r.description || "").toLowerCase();
    const rules = rulesByBook.get(r.book) ?? [];
    let matchedId: string | null = null;
    for (const rule of rules) {
      const pattern = rule.merchant_pattern.toLowerCase();
      if (!pattern) continue;
      if (merchant.includes(pattern) || pattern.includes(merchant)) {
        matchedId = rule.category_id;
        break;
      }
    }
    if (matchedId) {
      const { error } = await admin
        .from("transactions")
        .update({ category_id: matchedId })
        .eq("id", r.id);
      if (!error) stats.rule_applied += 1;
    } else {
      aiCandidates.push(r);
    }
  }

  if (aiCandidates.length === 0) return stats;

  // --- Phase 2: Claude for leftovers ------------------------------------
  const categoriesByBook: Record<Book, CategoryHint[]> = {
    personal: [],
    business: [],
    nonprofit: [],
  };
  for (const book of books) {
    const { data } = await admin
      .from("categories")
      .select("id, name")
      .eq("book", book)
      .eq("is_archived", false);
    categoriesByBook[book] = ((data ?? []) as CategoryHint[]).map((c) => ({
      id: c.id,
      name: c.name,
    }));
  }

  const claudeInputs: CategorizeInputTxn[] = aiCandidates.map((r) => ({
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

  const results = await categorizeBatch(claudeInputs, categoriesByBook);

  const nowIso = new Date().toISOString();
  for (const r of aiCandidates) {
    const hit = results.get(r.id);
    if (!hit) {
      stats.skipped += 1;
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
    if (!error) stats.ai_applied += 1;
    else stats.skipped += 1;
  }

  return stats;
}
