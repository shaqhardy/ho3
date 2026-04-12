import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type BoolKey =
  | "bills_due"
  | "shortfall_warning"
  | "plaid_sync_errors"
  | "daily_summary"
  | "large_transactions"
  | "income_alerts"
  | "low_balance_warning"
  | "bill_paid_confirmation"
  | "bill_not_paid_alert"
  | "subscription_renewal_warning"
  | "debt_milestone_paid_off"
  | "debt_milestone_halfway"
  | "debt_milestone_custom"
  | "plaid_reconnect_needed"
  | "category_overspend"
  | "goal_hit";

type NumKey =
  | "large_txn_threshold_personal"
  | "large_txn_threshold_business"
  | "large_txn_threshold_nonprofit";

const BOOL_KEYS: BoolKey[] = [
  "bills_due",
  "shortfall_warning",
  "plaid_sync_errors",
  "daily_summary",
  "large_transactions",
  "income_alerts",
  "low_balance_warning",
  "bill_paid_confirmation",
  "bill_not_paid_alert",
  "subscription_renewal_warning",
  "debt_milestone_paid_off",
  "debt_milestone_halfway",
  "debt_milestone_custom",
  "plaid_reconnect_needed",
  "category_overspend",
  "goal_hit",
];

const NUM_KEYS: NumKey[] = [
  "large_txn_threshold_personal",
  "large_txn_threshold_business",
  "large_txn_threshold_nonprofit",
];

const SELECT_COLS = [...BOOL_KEYS, ...NUM_KEYS, "user_id"].join(", ");

const DEFAULTS: Record<BoolKey, boolean> & Record<NumKey, number> = {
  bills_due: true,
  shortfall_warning: true,
  plaid_sync_errors: true,
  daily_summary: true,
  large_transactions: false,
  income_alerts: true,
  low_balance_warning: true,
  bill_paid_confirmation: true,
  bill_not_paid_alert: true,
  subscription_renewal_warning: true,
  debt_milestone_paid_off: true,
  debt_milestone_halfway: true,
  debt_milestone_custom: true,
  plaid_reconnect_needed: true,
  category_overspend: false,
  goal_hit: false,
  large_txn_threshold_personal: 100,
  large_txn_threshold_business: 250,
  large_txn_threshold_nonprofit: 250,
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await createServiceClient();
  const { data: existing } = await admin
    .from("notification_preferences")
    .select(SELECT_COLS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ preferences: existing });
  }

  // Create defaults row.
  const row = { user_id: user.id, ...DEFAULTS };
  const { error } = await admin.from("notification_preferences").insert(row);
  if (error) {
    console.error("[push preferences GET] insert error", error);
  }
  return NextResponse.json({ preferences: row });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, boolean | number> = {};
  for (const k of BOOL_KEYS) {
    if (typeof body[k] === "boolean") update[k] = body[k] as boolean;
  }
  for (const k of NUM_KEYS) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      update[k] = v;
    } else if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) update[k] = n;
    }
  }

  const admin = await createServiceClient();

  // Upsert so prefs row is created if missing.
  const { data, error } = await admin
    .from("notification_preferences")
    .upsert(
      { user_id: user.id, ...DEFAULTS, ...update },
      { onConflict: "user_id" }
    )
    .select(SELECT_COLS)
    .single();

  if (error) {
    console.error("[push preferences PUT] upsert error", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }

  return NextResponse.json({ preferences: data });
}
