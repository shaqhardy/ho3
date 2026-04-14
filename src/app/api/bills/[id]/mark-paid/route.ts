import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { advanceDueDate } from "@/lib/bills/recurrence";

type Book = "personal" | "business" | "nonprofit";

interface Body {
  date_paid?: string;
  amount_paid?: number;
  account_id?: string | null;
  transaction_id?: string | null;
  manual?: boolean;
  note?: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;

  const admin = await createServiceClient();
  const { data: bill } = await admin
    .from("bills")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!bill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (profile?.role !== "admin" && !allowed.includes(bill.book as Book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const datePaid =
    body.date_paid || new Date().toISOString().slice(0, 10);
  const amountPaid = Number(
    body.amount_paid ?? bill.typical_amount ?? bill.amount ?? 0
  );
  if (!(amountPaid > 0))
    return NextResponse.json({ error: "amount_paid required" }, { status: 400 });

  await admin.from("bill_payments").insert({
    bill_id: id,
    date_paid: datePaid,
    amount_paid: amountPaid,
    account_id: body.account_id ?? bill.account_id,
    transaction_id: body.transaction_id ?? null,
    manual: body.manual ?? true,
    note: body.note ?? null,
  });

  const nextDue = advanceDueDate(
    bill.due_date as string,
    bill.frequency as "weekly" | "monthly" | "quarterly" | "yearly" | null,
    !!bill.is_recurring,
    bill.due_day as number | null
  );

  await admin
    .from("bills")
    .update({
      status: nextDue ? "upcoming" : "paid",
      last_paid_date: datePaid,
      last_paid_amount: amountPaid,
      due_date: nextDue ?? bill.due_date,
    })
    .eq("id", id);

  return NextResponse.json({ success: true, next_due_date: nextDue });
}
