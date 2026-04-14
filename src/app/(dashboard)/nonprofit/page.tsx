import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BookDashboard } from "@/components/book-dashboard";

export default async function NonprofitPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [
    { data: accounts },
    { data: transactions },
    { data: subscriptions },
    { data: categories },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("book", "nonprofit")
      .eq("is_hidden", false)
      .order("name"),
    supabase
      .from("transactions")
      .select("*, categories(name)")
      .eq("book", "nonprofit")
      .order("date", { ascending: false })
      .limit(5000),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("book", "nonprofit")
      .order("next_charge_date"),
    supabase
      .from("categories")
      .select("*")
      .eq("book", "nonprofit")
      .order("name"),
  ]);

  return (
    <BookDashboard
      book="nonprofit"
      bookLabel="Nonprofit"
      accounts={accounts || []}
      transactions={transactions || []}
      subscriptions={subscriptions || []}
      categories={categories || []}
    />
  );
}
