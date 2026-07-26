import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "se_session";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;

  if (token && secret) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
      });
      return NextResponse.next();
    } catch {
      // Invalid and expired sessions follow the same safe redirect path.
    }
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  const response = NextResponse.redirect(login);
  if (token) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/packages/:path*",
    "/matrix/:path*",
    "/team/:path*",
    "/wallet/:path*",
    "/booster/:path*",
    "/autopool/:path*",
    "/dividend/:path*",
    "/income/:path*",
    "/magic-level/:path*",
  ],
};
