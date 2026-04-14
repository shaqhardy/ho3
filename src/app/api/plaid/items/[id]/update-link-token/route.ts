import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { plaidFetch } from "@/lib/plaid/api";
import { plaidWebhookUrl } from "@/lib/plaid/webhook-url";

// Generate a Plaid Link token in **update mode** for this bank so the user
// can re-authenticate without losing the plaid_item_id or transaction history.
// This is also the path to *upgrade* an existing item's days_requested to 730 —
// Plaid associates the new config with the Item on successful update.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { user, admin } = gate;

  const { data: item } = await admin
    .from("plaid_items")
    .select("id, plaid_access_token")
    .eq("id", id)
    .maybeSingle();
  if (!item)
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });

  const { ok, data } = await plaidFetch<{ link_token?: string }>(
    "/link/token/create",
    {
      user: { client_user_id: user.id },
      client_name: "HO3",
      country_codes: ["US"],
      language: "en",
      access_token: item.plaid_access_token,
      webhook: plaidWebhookUrl(),
      transactions: { days_requested: 730 },
    }
  );
  if (!ok || !data.link_token) {
    return NextResponse.json(
      { error: data.error_message || "Failed to create update link token" },
      { status: 400 }
    );
  }

  return NextResponse.json({ link_token: data.link_token });
}
