import { NextRequest } from "next/server";

export function requireAdmin(req: NextRequest): { ok: true } | { ok: false; status: number; message: string } {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return { ok: false, status: 500, message: "ADMIN_TOKEN not configured on server" };
  }
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer !== token) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}
