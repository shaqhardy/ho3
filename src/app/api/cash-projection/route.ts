import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";
import {
  CASH_WINDOWS,
  windowBounds,
  windowLabel,
  type CashWindow,
} from "@/lib/cash-projection/window";
import {
  CASH_MODES,
  computeCashProjection,
  type CashMode,
} from "@/lib/cash-projection/compute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const bookParam = (sp.get("book") ?? "personal") as Book | "all";
  const windowParam = (sp.get("window") ?? "month") as CashWindow;
  const modeParam = (sp.get("mode") ?? "projected") as CashMode;
  const includeDetail = sp.get("detail") === "true";

  if (bookParam !== "all" && !BOOKS.includes(bookParam as Book))
    return NextResponse.json({ error: "invalid book" }, { status: 400 });
  if (!CASH_WINDOWS.includes(windowParam))
    return NextResponse.json({ error: "invalid window" }, { status: 400 });
  if (!CASH_MODES.includes(modeParam))
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });

  // Book-scope authorization via profiles.allowed_books (mirrors the
  // existing /api/income gate).
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

  let books: Book[];
  let isOverview: boolean;
  if (bookParam === "all") {
    books = isAdmin ? [...BOOKS] : allowed;
    isOverview = true;
  } else {
    if (!isAdmin && !allowed.includes(bookParam))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    books = [bookParam];
    isOverview = false;
  }

  if (books.length === 0)
    return NextResponse.json({ error: "No accessible books" }, { status: 403 });

  const today = new Date().toISOString().slice(0, 10);
  const bounds = windowBounds(windowParam, today);

  try {
    const result = await computeCashProjection(admin, {
      books,
      isOverview,
      windowStart: bounds.start,
      windowEnd: bounds.end,
      windowRolls: bounds.rolls,
      windowLabel: windowLabel(windowParam),
      window: windowParam,
      mode: modeParam,
      includeDetail,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cash-projection] compute error", message);
    return NextResponse.json(
      { error: "Failed to compute projection" },
      { status: 500 }
    );
  }
}
