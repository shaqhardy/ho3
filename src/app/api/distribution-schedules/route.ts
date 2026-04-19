import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  DISTRIBUTION_CADENCES,
  type Book,
  type DistributionCadence,
} from "@/lib/types";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

interface CreateBody {
  source_book: Book;
  target_book: Book;
  amount: number;
  cadence: DistributionCadence;
  anchor_date: string;
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const includeInactive = sp.get("include_inactive") === "true";

  let q = supabase
    .from("distribution_schedules")
    .select("*")
    .order("created_at", { ascending: false });
  if (!includeInactive) q = q.eq("is_active", true);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ schedules: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.source_book || !BOOKS.includes(body.source_book))
    return NextResponse.json(
      { error: "source_book required" },
      { status: 400 }
    );
  if (!body.target_book || !BOOKS.includes(body.target_book))
    return NextResponse.json(
      { error: "target_book required" },
      { status: 400 }
    );
  if (body.source_book === body.target_book)
    return NextResponse.json(
      { error: "source_book must differ from target_book" },
      { status: 400 }
    );
  if (!body.amount || body.amount <= 0)
    return NextResponse.json(
      { error: "amount must be positive" },
      { status: 400 }
    );
  if (!body.cadence || !DISTRIBUTION_CADENCES.includes(body.cadence))
    return NextResponse.json({ error: "invalid cadence" }, { status: 400 });
  if (!body.anchor_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.anchor_date))
    return NextResponse.json(
      { error: "anchor_date must be YYYY-MM-DD" },
      { status: 400 }
    );

  const customDays = validateCustomDays(body.custom_days);
  if (body.cadence === "custom" && !customDays)
    return NextResponse.json(
      { error: "custom cadence requires at least one custom_days entry (1-31)" },
      { status: 400 }
    );

  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const allowed = (profile.allowed_books ?? []) as Book[];
  const isAdmin = profile.role === "admin";
  if (!isAdmin && (!allowed.includes(body.source_book) || !allowed.includes(body.target_book)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await admin
    .from("distribution_schedules")
    .insert({
      user_id: user.id,
      source_book: body.source_book,
      target_book: body.target_book,
      amount: body.amount,
      cadence: body.cadence,
      anchor_date: body.anchor_date,
      custom_days: customDays,
      notes: body.notes?.trim() || null,
      is_active: body.is_active ?? true,
    })
    .select("*")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ schedule: data });
}
