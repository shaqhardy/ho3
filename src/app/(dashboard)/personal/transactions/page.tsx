import { redirect } from "next/navigation";
import { loadTransactionsData } from "@/lib/transactions/load";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const dynamic = "force-dynamic";

export default async function PersonalTransactionsPage() {
  const data = await loadTransactionsData("personal");
  if (data === "unauthorized") redirect("/login");
  if (data === "forbidden") redirect("/personal");
  return <TransactionsView book="personal" bookLabel="Personal" {...data} />;
}
