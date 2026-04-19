import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BookDashboard } from "@/components/book-dashboard";
import { CashProjectionSection } from "@/components/cash-projection/cash-projection-section";

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

  const hasData =
    (accounts?.length ?? 0) > 0 ||
    (transactions?.length ?? 0) > 0 ||
    (subscriptions?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <CashProjectionSection book="nonprofit" hasData={hasData} />
      <BookDashboard
        book="nonprofit"
        bookLabel="Nonprofit"
        accounts={accounts || []}
        transactions={transactions || []}
        subscriptions={subscriptions || []}
        categories={categories || []}
      />
    </div>
  );
}
