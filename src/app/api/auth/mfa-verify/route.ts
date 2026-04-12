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

  // Collect cookies Supabase wants to set
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
          // Replace (not append) so we always have the latest tokens
          pendingCookies.length = 0;
          cookiesToSet.forEach((c) => pendingCookies.push(c));
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
    return NextResponse.json({ error: challengeError.message }, { status: 400 });
  }

  const { data: verifyData, error: verifyError } =
    await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

  if (verifyError) {
    console.error("[mfa-verify] Verify error:", verifyError.message);
    return NextResponse.json({ error: verifyError.message }, { status: 400 });
  }

  console.log("[mfa-verify] MFA verified. Setting cookies on response.");

  // Build response with cookies set DIRECTLY on NextResponse
  const response = NextResponse.json({
    success: true,
    // Return tokens so client can call setSession() as belt-and-suspenders
    access_token: verifyData?.access_token,
    refresh_token: verifyData?.refresh_token,
  });

  // Set cookies on the response object (guaranteed Set-Cookie headers)
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options as Record<string, string>);
  }

  console.log(
    "[mfa-verify] Set-Cookie headers:",
    response.headers.getSetCookie().length,
    "cookies"
  );

  return response;
}
