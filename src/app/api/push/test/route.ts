import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/send";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dedupKey = `test_${user.id}_${Date.now()}`;
  const result = await sendPushToUser(
    user.id,
    {
      title: "HO3 Test",
      body: "Push notifications are working!",
      url: "/overview",
      tag: "ho3-test",
    },
    dedupKey,
    "test"
  );

  return NextResponse.json({
    sent: result.sent,
    failed: result.failed,
  });
}
