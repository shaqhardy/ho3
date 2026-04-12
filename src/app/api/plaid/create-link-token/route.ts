import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plaidBaseUrl =
    process.env.PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : "https://sandbox.plaid.com";

  const response = await fetch(`${plaidBaseUrl}/link/token/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      user: { client_user_id: user.id },
      client_name: "HO3",
      products: ["transactions", "liabilities"],
      country_codes: ["US"],
      language: "en",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      { error: data.error_message || "Failed to create link token" },
      { status: 400 }
    );
  }

  return NextResponse.json({ link_token: data.link_token });
}
