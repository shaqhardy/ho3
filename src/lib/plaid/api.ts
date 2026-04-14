const PLAID_BASE =
  process.env.PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : "https://sandbox.plaid.com";

type PlaidJson = Record<string, unknown>;

export async function plaidFetch<T = PlaidJson>(
  path: string,
  body: PlaidJson
): Promise<{ ok: boolean; status: number; data: T & { error_code?: string; error_message?: string } }> {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  const data = (await res.json()) as T & {
    error_code?: string;
    error_message?: string;
  };
  return { ok: res.ok, status: res.status, data };
}
