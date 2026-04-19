import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  DISTRIBUTION_CADENCES,
  type Book,
  type DistributionCadence,
} from "@/lib/types";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

interface UpdateBody {
  source_book?: Book;
  target_book?: Book;
  amount?: number;
  cadence?: DistributionCadence;
  anchor_date?: string;
  custom_days?: number[] | null;
  notes?: string | null;
  is_active?: boolean;
}

function validateCustomDays(days: unknown): number[] | null {
  if (days == null) return null;
  if (!Array.isArray(days)) return null;
  const clean = days
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  return clean.length > 0 ? clean : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = await createServiceClient();
  const { data: existing } = await admin
    .from("distribution_schedules")
    .select("id, source_book, target_book, cadence")
    .eq("id", id)
    .maybeSingle();
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const allowed = (profile.allowed_books ?? []) as Book[];
  const isAdmin = profile.role === "admin";
  const effectiveSource = (body.source_book ?? existing.source_book) as Book;
  const effectiveTarget = (body.target_book ?? existing.target_book) as Book;
  if (
    !isAdmin &&
    (!allowed.includes(effectiveSource) || !allowed.includes(effectiveTarget))
  )
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = {};
  if (body.source_book !== undefined) {
    if (!BOOKS.includes(body.source_book))
      return NextResponse.json({ error: "invalid source_book" }, { status: 400 });
    patch.source_book = body.source_book;
  }
  if (body.target_book !== undefined) {
    if (!BOOKS.includes(body.target_book))
      return NextResponse.json({ error: "invalid target_book" }, { status: 400 });
    patch.target_book = body.target_book;
  }
  if (body.amount !== undefined) {
    if (!(body.amount > 0))
      return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
    patch.amount = body.amount;
  }
  if (body.cadence !== undefined) {
    if (!DISTRIBUTION_CADENCES.includes(body.cadence))
      return NextResponse.json({ error: "invalid cadence" }, { status: 400 });
    patch.cadence = body.cadence;
  }
  if (body.anchor_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.anchor_date))
      return NextResponse.json(
        { error: "anchor_date must be YYYY-MM-DD" },
        { status: 400 }
      );
    patch.anchor_date = body.anchor_date;
  }
  if (body.custom_days !== undefined) {
    patch.custom_days = validateCustomDays(body.custom_days);
  }
  if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  // Enforce the custom-cadence invariant if either changes.
  const effectiveCadence = (patch.cadence ?? existing.cadence) as DistributionCadence;
  if (effectiveCadence === "custom") {
    const effectiveDays =
      patch.custom_days !== undefined
        ? (patch.custom_days as number[] | null)
        : undefined;
    if (effectiveDays === null)
      return NextResponse.json(
        { error: "custom cadence requires at least one custom_days entry (1-31)" },
        { status: 400 }
      );
  }

  // If schedule is being deactivated, also delete any future projected_income
  // rows tied to it so they stop showing up in forecasts immediately.
  if (body.is_active === false) {
    const today = new Date().toISOString().slice(0, 10);
    await admin
      .from("projected_income")
      .delete()
      .eq("linked_schedule_id", id)
      .gte("date", today);
  }

  const { data, error } = await admin
    .from("distribution_schedules")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ schedule: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await createServiceClient();
  const { data: existing } = await admin
    .from("distribution_schedules")
    .select("id, source_book, target_book")
    .eq("id", id)
    .maybeSingle();
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const allowed = (profile.allowed_books ?? []) as Book[];
  const isAdmin = profile.role === "admin";
  if (
    !isAdmin &&
    (!allowed.includes(existing.source_book as Book) ||
      !allowed.includes(existing.target_book as Book))
  )
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Soft delete per spec §15b — set is_active = false rather than dropping
  // the row. Also purge future projected_income so forecasts update
  // immediately.
  const today = new Date().toISOString().slice(0, 10);
  await admin
    .from("projected_income")
    .delete()
    .eq("linked_schedule_id", id)
    .gte("date", today);

  const { error } = await admin
    .from("distribution_schedules")
    .update({ is_active: false })
    .eq("id", id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
