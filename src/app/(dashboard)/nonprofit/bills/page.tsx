import { redirect } from "next/navigation";
import { loadBillsData } from "@/lib/bills/load";
import { BillsView } from "@/components/bills/bills-view";

export const dynamic = "force-dynamic";

export default async function NonprofitBillsPage() {
  const data = await loadBillsData("nonprofit");
  if (data === "unauthorized") redirect("/login");
  if (data === "forbidden") redirect("/nonprofit");
  return <BillsView book="nonprofit" bookLabel="Nonprofit" {...data} />;
}
