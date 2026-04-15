import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CategoriesManager } from "@/components/settings/categories-manager";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CategoriesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/login");

  const admin = await createServiceClient();

  const allowed: Book[] =
    profile.role === "admin"
      ? ["personal", "business", "nonprofit"]
      : ((profile.allowed_books ?? []) as Book[]);

  const [{ data: cats }, { data: txns }] = await Promise.all([
    admin
      .from("categories")
      .select(
        "id, book, name, parent_id, icon, color, is_shared, is_archived, sort_order, created_at"
      )
      .in("book", allowed)
      .order("book")
      .order("sort_order")
      .order("name"),
    admin
      .from("transactions")
      .select("category_id, book")
      .in("book", allowed),
  ]);

  // Per-category transaction counts (null-safe).
  const counts = new Map<string, number>();
  for (const row of (txns ?? []) as { category_id: string | null }[]) {
    if (!row.category_id) continue;
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  const categoriesWithCounts = ((cats ?? []) as Array<{
    id: string;
    book: Book;
    name: string;
    parent_id: string | null;
    icon: string | null;
    color: string | null;
    is_shared: boolean;
    is_archived: boolean;
    sort_order: number;
    created_at: string;
  }>).map((c) => ({
    ...c,
    txn_count: counts.get(c.id) ?? 0,
  }));

  return (
    <CategoriesManager
      categories={categoriesWithCounts}
      allowedBooks={allowed}
    />
  );
}
