import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

const BOOKS: readonly Book[] = ["personal", "business", "nonprofit"] as const;

// Distinct source suggestions for the Add Income autocomplete. Scoped by book
// so the dropdown stays relevant to the page the user is on.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const book = request.nextUrl.searchParams.get("book") as Book | null;

  let q = supabase
    .from("income_entries")
    .select("source")
    .not("source", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (book && BOOKS.includes(book)) q = q.eq("book", book);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const seen = new Set<string>();
  const sources: string[] = [];
  for (const r of (data ?? []) as { source: string | null }[]) {
    const s = (r.source ?? "").trim();
    if (!s) continue;
    if (seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    sources.push(s);
    if (sources.length >= 50) break;
  }

  return NextResponse.json({ sources });
}
