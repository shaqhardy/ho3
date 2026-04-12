import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { factorId, code } = body;

  if (!factorId || !code) {
    console.error("[mfa-verify] Missing factorId or code", { factorId: !!factorId, code: !!code });
    return NextResponse.json(
      { error: "factorId and code are required" },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  console.log("[mfa-verify] Cookies present:", allCookies.map(c => c.name));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return allCookies;
        },
        setAll(cookiesToSet) {
          console.log("[mfa-verify] setAll called with cookies:", cookiesToSet.map(c => c.name));
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[mfa-verify] No authenticated user found from cookies");
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  console.log("[mfa-verify] User authenticated:", user.id, user.email);

  // Create challenge
  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId });

  if (challengeError) {
    console.error("[mfa-verify] Challenge error:", challengeError.message);
    return NextResponse.json(
      { error: challengeError.message },
      { status: 400 }
    );
  }

  console.log("[mfa-verify] Challenge created:", challenge.id);

  // Verify the TOTP code — upgrades session to AAL2
  // setAll callback fires here, writing AAL2 JWT to Set-Cookie headers
  const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
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

  console.log("[mfa-verify] MFA verified successfully. Session AAL should be aal2.");

  return NextResponse.json({ success: true, aal: "aal2" });
}
