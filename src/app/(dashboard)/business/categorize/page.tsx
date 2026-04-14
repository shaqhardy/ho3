import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CategorizeView } from "@/components/transactions/categorize-view";
import { categorizationCompleteness } from "@/lib/transactions/completeness";

export const dynamic = "force-dynamic";

export default async function BusinessCategorizePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  if (
    profile?.role !== "admin" &&
    !(profile?.allowed_books ?? []).includes("business")
  )
    redirect("/business");

  const admin = await createServiceClient();
  const completeness = await categorizationCompleteness(admin, "business");
  const { data: uncat } = await admin
    .from("transactions")
    .select("id, merchant, description, amount, date, pfc_primary, pfc_detailed, is_income")
    .eq("book", "business")
    .is("category_id", null)
    .eq("is_income", false)
    .not("pfc_primary", "in", "(TRANSFER_IN,TRANSFER_OUT)")
    .order("date", { ascending: false })
    .limit(2000);
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("book", "business")
    .order("name");

  return (
    <CategorizeView
      book="business"
      bookLabel="Business"
      completeness={completeness}
      uncategorized={(uncat || []) as unknown as Parameters<typeof CategorizeView>[0]["uncategorized"]}
      categories={(categories || []) as { id: string; name: string }[]}
    />
  );
}
