import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Auto-match business→personal transfers
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get recent business expenses that look like owner pay
  const { data: businessTxns } = await adminSupabase
    .from("transactions")
    .select("*")
    .eq("book", "business")
    .eq("is_income", false)
    .gte(
      "date",
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]
    )
    .order("date", { ascending: false });

  // Get recent personal income
  const { data: personalTxns } = await adminSupabase
    .from("transactions")
    .select("*")
    .eq("book", "personal")
    .eq("is_income", true)
    .gte(
      "date",
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]
    )
    .order("date", { ascending: false });

  // Get existing bridge links to avoid duplicates
  const { data: existingLinks } = await adminSupabase
    .from("bridge_links")
    .select("business_transaction_id, personal_transaction_id");

  const linkedBiz = new Set(
    (existingLinks || []).map((l) => l.business_transaction_id)
  );
  const linkedPer = new Set(
    (existingLinks || []).map((l) => l.personal_transaction_id)
  );

  let matched = 0;

  for (const bizTxn of businessTxns || []) {
    if (linkedBiz.has(bizTxn.id)) continue;

    // Look for matching personal income within 3-day window
    const bizDate = new Date(bizTxn.date + "T00:00:00");
    const bizAmount = Number(bizTxn.amount);

    for (const perTxn of personalTxns || []) {
      if (linkedPer.has(perTxn.id)) continue;

      const perDate = new Date(perTxn.date + "T00:00:00");
      const perAmount = Number(perTxn.amount);
      const dayDiff = Math.abs(
        (bizDate.getTime() - perDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Match by amount (exact) and date (within 3 days)
      if (Math.abs(bizAmount - perAmount) < 0.01 && dayDiff <= 3) {
        await adminSupabase.from("bridge_links").insert({
          business_transaction_id: bizTxn.id,
          personal_transaction_id: perTxn.id,
          amount: bizAmount,
        });

        linkedBiz.add(bizTxn.id);
        linkedPer.add(perTxn.id);
        matched++;
        break;
      }
    }
  }

  return NextResponse.json({ matched });
}
