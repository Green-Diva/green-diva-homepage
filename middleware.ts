import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/favicon.ico",
]);

const STATIC_PREFIXES = ["/_next", "/fonts", "/images", "/videos"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const sid = req.cookies.get("gd_session")?.value;
  if (sid) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname + (req.nextUrl.search ?? ""));
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
