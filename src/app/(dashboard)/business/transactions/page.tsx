import { redirect } from "next/navigation";
import { loadTransactionsData } from "@/lib/transactions/load";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const dynamic = "force-dynamic";

export default async function BusinessTransactionsPage() {
  const data = await loadTransactionsData("business");
  if (data === "unauthorized") redirect("/login");
  if (data === "forbidden") redirect("/business");
  return <TransactionsView book="business" bookLabel="Business" {...data} />;
}
