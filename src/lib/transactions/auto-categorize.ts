import type { SupabaseClient } from "@supabase/supabase-js";
import { pfcToCategoryName, type Book } from "@/lib/transactions/pfc-map";

/**
 * Auto-categorize any transaction that:
 *   - has pfc_primary set, and
 *   - has category_id = null
 *
 * Uses our PFC→category name map. Also writes a merchant→category entry to
 * category_rules so future imports with the same merchant inherit the choice
 * (and so a merchant's later transactions stay aligned).
 *
 * Returns counts. Idempotent: safe to rerun.
 */
export async function autoCategorizeFromPFC(
  admin: SupabaseClient,
  book: Book
): Promise<{
  categorized: number;
  rules_created: number;
  skipped_no_map: number;
}> {
  // Pull all categories for this book once.
  const { data: cats } = await admin
    .from("categories")
    .select("id, name")
    .eq("book", book);
  const nameToId = new Map<string, string>();
  for (const c of (cats ?? []) as { id: string; name: string }[]) {
    nameToId.set(c.name, c.id);
  }

  // Pull all uncategorized transactions with PFC in batches of 1000 to stay
  // under Supabase's default row cap.
  let offset = 0;
  let categorized = 0;
  let skipped = 0;
  const rulePairs = new Map<string, { merchant: string; categoryId: string }>();

  while (true) {
    const { data: rows } = await admin
      .from("transactions")
      .select("id, merchant, pfc_primary, pfc_detailed")
      .eq("book", book)
      .is("category_id", null)
      .not("pfc_primary", "is", null)
      .order("id")
      .range(offset, offset + 999);
    if (!rows || rows.length === 0) break;

    const updates: Array<{ id: string; category_id: string }> = [];
    for (const r of rows as Array<{
      id: string;
      merchant: string | null;
      pfc_primary: string | null;
      pfc_detailed: string | null;
    }>) {
      const name = pfcToCategoryName(
        { primary: r.pfc_primary, detailed: r.pfc_detailed },
        book
      );
      if (!name) {
        skipped++;
        continue;
      }
      const catId = nameToId.get(name);
      if (!catId) {
        skipped++;
        continue;
      }
      updates.push({ id: r.id, category_id: catId });
      if (r.merchant) {
        rulePairs.set(`${book}::${r.merchant}`, {
          merchant: r.merchant,
          categoryId: catId,
        });
      }
    }

    // Apply per-row updates. Supabase doesn't support batched UPDATE with
    // different values, so we do it one-by-one. 1000 rows is quick.
    for (const u of updates) {
      await admin
        .from("transactions")
        .update({ category_id: u.category_id })
        .eq("id", u.id);
      categorized++;
    }

    offset += rows.length;
    if (rows.length < 1000) break;
  }

  // Seed category_rules from the merchant→category pairs we just learned.
  let rules_created = 0;
  for (const { merchant, categoryId } of rulePairs.values()) {
    const { data: existing } = await admin
      .from("category_rules")
      .select("id, category_id")
      .eq("book", book)
      .eq("merchant_pattern", merchant)
      .maybeSingle();
    if (existing) {
      if (existing.category_id !== categoryId) {
        await admin
          .from("category_rules")
          .update({ category_id: categoryId })
          .eq("id", existing.id);
      }
    } else {
      await admin.from("category_rules").insert({
        book,
        merchant_pattern: merchant,
        category_id: categoryId,
      });
      rules_created++;
    }
  }

  return { categorized, rules_created, skipped_no_map: skipped };
}
