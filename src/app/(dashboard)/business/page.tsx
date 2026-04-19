import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BookDashboard } from "@/components/book-dashboard";
import { CashProjectionSection } from "@/components/cash-projection/cash-projection-section";

export default async function BusinessPage() {
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
      .eq("book", "business")
      .eq("is_hidden", false)
      .order("name"),
    supabase
      .from("transactions")
      .select("*, categories(name)")
      .eq("book", "business")
      .order("date", { ascending: false })
      .limit(5000),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("book", "business")
      .order("next_charge_date"),
    supabase
      .from("categories")
      .select("*")
      .eq("book", "business")
      .order("name"),
  ]);

  const hasData =
    (accounts?.length ?? 0) > 0 ||
    (transactions?.length ?? 0) > 0 ||
    (subscriptions?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <CashProjectionSection book="business" hasData={hasData} />
      <BookDashboard
        book="business"
        bookLabel="Business"
        accounts={accounts || []}
        transactions={transactions || []}
        subscriptions={subscriptions || []}
        categories={categories || []}
      />
    </div>
  );
}
