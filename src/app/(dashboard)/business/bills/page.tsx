import { redirect } from "next/navigation";
import { loadBillsData } from "@/lib/bills/load";
import { BillsView } from "@/components/bills/bills-view";

export const dynamic = "force-dynamic";

export default async function BusinessBillsPage() {
  const data = await loadBillsData("business");
  if (data === "unauthorized") redirect("/login");
  if (data === "forbidden") redirect("/business");
  return <BillsView book="business" bookLabel="Business" {...data} />;
}
