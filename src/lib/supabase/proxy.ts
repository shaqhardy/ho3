import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth", "/api", "/mfa"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not logged in — redirect to login (except public paths)
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Logged in — enforce MFA on dashboard routes
  if (user && !isPublic) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aal?.currentLevel !== "aal2") {
      // Check if user has enrolled a TOTP factor
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const hasVerifiedFactor = factors?.totp?.some(
        (f) => f.status === "verified"
      );

      const url = request.nextUrl.clone();
      url.pathname = hasVerifiedFactor ? "/mfa/verify" : "/mfa/enroll";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
