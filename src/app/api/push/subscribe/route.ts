import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

interface SubscribeBody {
  subscription?: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
  userAgent?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json(
      { error: "Invalid subscription" },
      { status: 400 }
    );
  }

  const admin = await createServiceClient();

  const { error: subErr } = await admin.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: body.userAgent ?? null,
      enabled: true,
    },
    { onConflict: "endpoint" }
  );
  if (subErr) {
    console.error("[push subscribe] upsert error", subErr);
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
  }

  // Ensure a preferences row exists (default: all alerts on).
  const { data: existing } = await admin
    .from("notification_preferences")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing) {
    await admin.from("notification_preferences").insert({
      user_id: user.id,
      bills_due: true,
      shortfall_warning: true,
      plaid_sync_errors: true,
      daily_summary: true,
    });
  }

  return NextResponse.json({ success: true });
}
