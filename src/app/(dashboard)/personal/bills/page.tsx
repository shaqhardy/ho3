import { redirect } from "next/navigation";
import { loadBillsData } from "@/lib/bills/load";
import { BillsView } from "@/components/bills/bills-view";

export const dynamic = "force-dynamic";

export default async function PersonalBillsPage() {
  const data = await loadBillsData("personal");
  if (data === "unauthorized") redirect("/login");
  if (data === "forbidden") redirect("/personal");
  return <BillsView book="personal" bookLabel="Personal" {...data} />;
}
