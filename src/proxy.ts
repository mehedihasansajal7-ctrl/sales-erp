import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight edge-of-app guard (Next.js 16 `proxy.ts` convention, the renamed
 * `middleware.ts`). It only checks that a session cookie is present so that
 * unauthenticated browsers are sent to the sign-in page quickly.
 *
 * The real authorisation happens server-side on every page and every action
 * (`src/lib/auth.ts` → requireUser / requirePermission) and inside every service
 * function, so a forged cookie gets nowhere.
 */
const PUBLIC_PATHS = ["/login", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get("erp_session")?.value);

  if (!hasSession && request.method === "GET") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static assets. Server Action POSTs
     * are deliberately left inside the matcher so a signed-out browser cannot
     * reach an action endpoint without a cookie (the action re-checks anyway).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
