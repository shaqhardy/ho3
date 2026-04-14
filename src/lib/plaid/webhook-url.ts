// Resolve the public URL Plaid should hit for webhooks. We embed a secret in
// the query string so the handler can reject forged requests without needing
// to stand up JWT/JWK verification. Plaid accepts any HTTPS URL, including
// ones with query params.
//
// Domain precedence:
//   1. PLAID_WEBHOOK_BASE_URL (explicit override — use for staging / previews)
//   2. PUBLIC_APP_URL
//   3. https://ho3.shaqhardy.com (canonical production alias)

export function plaidWebhookUrl(): string {
  const base =
    process.env.PLAID_WEBHOOK_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    "https://ho3.shaqhardy.com";
  const secret = process.env.PLAID_WEBHOOK_SECRET || "";
  const qs = secret ? `?k=${encodeURIComponent(secret)}` : "";
  return `${base.replace(/\/$/, "")}/api/plaid/webhook${qs}`;
}
