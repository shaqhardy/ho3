import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth", "/api", "/mfa", "/privacy"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // DEBUG: Log cookies on protected routes
  if (!isPublic) {
    const allCookies = request.cookies.getAll();
    const sbCookies = allCookies.filter((c) => c.name.startsWith("sb-"));
    console.log(
      `[proxy] ${pathname} | cookies total=${allCookies.length} sb-cookies=${sbCookies.length} names=[${sbCookies.map((c) => c.name).join(", ")}]`
    );
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          if (!isPublic) {
            console.log(
              `[proxy] ${pathname} | setAll called: [${cookiesToSet.map((c) => c.name).join(", ")}]`
            );
          }
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not logged in — redirect to login (except public paths)
  if (!user && !isPublic) {
    console.log(`[proxy] ${pathname} | REDIRECT to /login reason=no_user`);
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Logged in — enforce MFA on dashboard routes
  if (user && !isPublic) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    console.log(
      `[proxy] ${pathname} | user=${user.email} currentLevel=${aal?.currentLevel} nextLevel=${aal?.nextLevel}`
    );

    if (aal?.currentLevel !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const hasVerifiedFactor = factors?.totp?.some(
        (f) => f.status === "verified"
      );

      const target = hasVerifiedFactor ? "/mfa/verify" : "/mfa/enroll";
      console.log(
        `[proxy] ${pathname} | REDIRECT to ${target} reason=aal_not_aal2 currentLevel=${aal?.currentLevel} hasVerifiedFactor=${hasVerifiedFactor}`
      );

      const url = request.nextUrl.clone();
      url.pathname = target;
      return NextResponse.redirect(url);
    }

    console.log(`[proxy] ${pathname} | ALLOWED aal2 confirmed`);
  }

  return supabaseResponse;
}
