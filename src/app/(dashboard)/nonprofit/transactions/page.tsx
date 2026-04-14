import { redirect } from "next/navigation";
import { loadTransactionsData } from "@/lib/transactions/load";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const dynamic = "force-dynamic";

export default async function NonprofitTransactionsPage() {
  const data = await loadTransactionsData("nonprofit");
  if (data === "unauthorized") redirect("/login");
  if (data === "forbidden") redirect("/nonprofit");
  return <TransactionsView book="nonprofit" bookLabel="Nonprofit" {...data} />;
}
