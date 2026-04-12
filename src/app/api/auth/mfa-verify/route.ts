import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { factorId, code } = body;

  if (!factorId || !code) {
    return NextResponse.json(
      { error: "factorId and code are required" },
      { status: 400 }
    );
  }

  // Collect cookies that Supabase wants to set — we'll put them on the
  // NextResponse ourselves instead of relying on cookies() from next/headers
  const pendingCookies: {
    name: string;
    value: string;
    options: Record<string, unknown>;
  }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          console.log(
            "[mfa-verify] setAll called:",
            cookiesToSet.map((c) => c.name)
          );
          cookiesToSet.forEach((cookie) => pendingCookies.push(cookie));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[mfa-verify] Not authenticated");
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  console.log("[mfa-verify] User:", user.email);

  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId });

  if (challengeError) {
    console.error("[mfa-verify] Challenge error:", challengeError.message);
    return NextResponse.json(
      { error: challengeError.message },
      { status: 400 }
    );
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) {
    console.error("[mfa-verify] Verify error:", verifyError.message);
    return NextResponse.json(
      { error: verifyError.message },
      { status: 400 }
    );
  }

  console.log(
    "[mfa-verify] Success. Pending cookies to set:",
    pendingCookies.map((c) => c.name)
  );

  // Build the response and set cookies DIRECTLY on the NextResponse object
  const response = NextResponse.json({ success: true });

  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options as Record<string, string>);
  }

  console.log(
    "[mfa-verify] Response Set-Cookie count:",
    response.headers.getSetCookie().length
  );

  return response;
}
