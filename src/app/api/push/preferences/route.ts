import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

interface PreferencesBody {
  bills_due?: boolean;
  shortfall_warning?: boolean;
  plaid_sync_errors?: boolean;
  daily_summary?: boolean;
}

const DEFAULTS = {
  bills_due: true,
  shortfall_warning: true,
  plaid_sync_errors: true,
  daily_summary: true,
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
    .select(
      "user_id, bills_due, shortfall_warning, plaid_sync_errors, daily_summary"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ preferences: existing });
  }

  // Create defaults.
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

  let body: PreferencesBody;
  try {
    body = (await request.json()) as PreferencesBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: PreferencesBody = {};
  if (typeof body.bills_due === "boolean") update.bills_due = body.bills_due;
  if (typeof body.shortfall_warning === "boolean")
    update.shortfall_warning = body.shortfall_warning;
  if (typeof body.plaid_sync_errors === "boolean")
    update.plaid_sync_errors = body.plaid_sync_errors;
  if (typeof body.daily_summary === "boolean")
    update.daily_summary = body.daily_summary;

  const admin = await createServiceClient();

  // Upsert so prefs row is created if missing.
  const { data, error } = await admin
    .from("notification_preferences")
    .upsert(
      { user_id: user.id, ...DEFAULTS, ...update },
      { onConflict: "user_id" }
    )
    .select(
      "user_id, bills_due, shortfall_warning, plaid_sync_errors, daily_summary"
    )
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
