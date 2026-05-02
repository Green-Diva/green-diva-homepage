import { NextRequest, NextResponse } from "next/server";

// PROJECT POLICY: Every route requires login by default. This whitelist is
// the entire set of public paths — exact match only. Do NOT add a route
// here without the user's explicit approval; if you think a new route
// should be public, ask first. PUBLIC_PREFIXES is intentionally empty for
// the same reason — never re-introduce wildcards.
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/locale",
  "/sacred-terms",
  "/privacy-covenant",
  "/favicon.ico",
]);

const PUBLIC_PREFIXES: string[] = [];

const STATIC_PREFIXES = ["/_next", "/fonts", "/images", "/videos"];

const VAULT_COOKIE = "gd_vault";

async function verifyVaultCookie(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const idx = token.indexOf(".");
  if (idx < 0) return false;
  const exp = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const secret = process.env.VAULT_COOKIE_SECRET;
  if (!secret || secret.length < 16) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(exp),
  );
  const bin = String.fromCharCode(...new Uint8Array(expected));
  const expectedB64 = btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (sig.length !== expectedB64.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expectedB64.charCodeAt(i);
  }
  return diff === 0;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfBlocked(req: NextRequest): boolean {
  if (!STATE_CHANGING_METHODS.has(req.method)) return false;
  if (!req.nextUrl.pathname.startsWith("/api/")) return false;
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (!host) return true;
  const expectedHost = host.toLowerCase();
  const ok = (url: string | null) => {
    if (!url) return false;
    try {
      return new URL(url).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  };
  if (origin) return !ok(origin);
  if (referer) return !ok(referer);
  return true;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (csrfBlocked(req)) {
    return NextResponse.json({ error: "CSRF check failed" }, { status: 403 });
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const sid = req.cookies.get("gd_session")?.value;
  if (!sid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname + (req.nextUrl.search ?? ""));
    return NextResponse.redirect(url);
  }

  if (pathname === "/vault" || pathname.startsWith("/vault/")) {
    const vt = req.cookies.get(VAULT_COOKIE)?.value;
    const ok = await verifyVaultCookie(vt);
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
