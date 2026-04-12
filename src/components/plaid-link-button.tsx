"use client";

import { useState, useCallback } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useRouter } from "next/navigation";

export function PlaidLinkButton() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const getLinkToken = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/plaid/create-link-token", { method: "POST" });
    const data = await res.json();
    if (data.link_token) {
      setLinkToken(data.link_token);
    }
    setLoading(false);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_token,
          institution: metadata.institution,
        }),
      });
      router.refresh();
    },
  });

  if (!linkToken) {
    return (
      <button
        onClick={getLinkToken}
        disabled={loading}
        className="rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      >
        {loading ? "Preparing..." : "Connect Bank Account"}
      </button>
    );
  }

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      className="rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
    >
      Connect Bank Account
    </button>
  );
}
