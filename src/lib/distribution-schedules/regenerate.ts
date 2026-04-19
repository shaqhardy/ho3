import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book, DistributionCadence } from "@/lib/types";
import { computeOccurrences } from "./occurrences";

interface ScheduleRow {
  id: string;
  user_id: string;
  source_book: Book;
  target_book: Book;
  amount: number | string;
  cadence: DistributionCadence;
  anchor_date: string;
  custom_days: number[] | null;
  is_active: boolean;
}

export interface RegenerateResult {
  active_schedules: number;
  rows_upserted: number;
  rows_purged: number;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Regenerate `projected_income` rows sourced from `distribution_schedules`.
 * Strategy per schedule:
 *   - Delete all future (date >= today) rows linked to this schedule.
 *   - For active schedules, insert the next 12 months of occurrences.
 * Inactive schedules are handled implicitly — their future rows are deleted
 * and nothing replaces them. Idempotent: re-running produces the same
 * materialized set.
 */
export async function regenerateDistributionProjections(
  admin: SupabaseClient
): Promise<RegenerateResult> {
  const { data: schedules, error } = await admin
    .from("distribution_schedules")
    .select(
      "id, user_id, source_book, target_book, amount, cadence, anchor_date, custom_days, is_active"
    );
  if (error) throw new Error(`load schedules: ${error.message}`);

  const today = todayYmd();
  const horizon = addMonthsYmd(today, 12);

  let active = 0;
  let purged = 0;
  let upserted = 0;

  for (const s of (schedules ?? []) as ScheduleRow[]) {
    // Purge future rows tied to this schedule before regenerating so the
    // projection always reflects the latest cadence/amount.
    const { count: deleted } = await admin
      .from("projected_income")
      .delete({ count: "exact" })
      .eq("linked_schedule_id", s.id)
      .gte("date", today);
    if (typeof deleted === "number") purged += deleted;

    if (!s.is_active) continue;
    active++;

    const occurrences = computeOccurrences({
      cadence: s.cadence,
      anchorDate: s.anchor_date,
      customDays: s.custom_days,
      from: today,
      to: horizon,
    });
    if (occurrences.length === 0) continue;

    const amount = Number(s.amount);
    const source =
      s.source_book === "business"
        ? "LLC distribution"
        : `${capitalize(s.source_book)} distribution`;

    const rows = occurrences.map((date) => ({
      book: s.target_book,
      date,
      amount,
      source,
      confidence: "expected" as const,
      classification: "owner_distribution" as const,
      linked_schedule_id: s.id,
    }));

    // Insert in chunks of 200 to stay under row-size limits for large
    // horizons × many schedules.
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error: insertErr } = await admin
        .from("projected_income")
        .insert(slice);
      if (insertErr) {
        // Partial idempotence: if a unique-index race hits (shouldn't, since
        // we just deleted), swallow and continue rather than aborting the
        // whole job.
        console.error(
          "[distribution regen] insert error",
          s.id,
          insertErr.message
        );
        continue;
      }
      upserted += slice.length;
    }
  }

  return {
    active_schedules: active,
    rows_upserted: upserted,
    rows_purged: purged,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
