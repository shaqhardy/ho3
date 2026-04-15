import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  book: Book;
  name: string;
  parent_id?: string | null;
  color?: string | null;
  icon?: string | null;
  is_shared?: boolean;
  sort_order?: number;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.book || !body.name?.trim())
    return NextResponse.json(
      { error: "book and name required" },
      { status: 400 }
    );

  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(body.book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const insertRow = {
    book: body.book,
    name: body.name.trim(),
    parent_id: body.parent_id ?? null,
    color: body.color ?? null,
    icon: body.icon ?? null,
    is_shared: body.is_shared ?? false,
    sort_order: body.sort_order ?? 0,
    is_archived: false,
  };

  const { data, error } = await admin
    .from("categories")
    .insert(insertRow)
    .select("*")
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true, category: data });
}
