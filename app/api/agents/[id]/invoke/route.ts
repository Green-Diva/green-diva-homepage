import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, AuthError, requireUser } from "@/lib/auth";
import { invokeAgent } from "@/lib/agents/invoke";

type Ctx = { params: Promise<{ id: string }> };

const FAIL_DELAY_MS = 200;
const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;

function checkAndConsume(agentId: string, limit: number): boolean {
  const now = Date.now();
  const cur = buckets.get(agentId);
  if (!cur || cur.resetAt < now) {
    buckets.set(agentId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (cur.count >= limit) return false;
  cur.count += 1;
  return true;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return NextResponse.json({ error: "Unauthorized" }, { status });
  }

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, codename: true, rateLimitPerMin: true, enabled: true },
  });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = me.level >= ADMIN_LEVEL;
  const headerToken = req.headers.get("x-internal-token");
  const envToken = process.env.AGENTS_INTERNAL_TOKEN ?? "";
  const tokenOk = !!headerToken && envToken.length >= 16 && constantTimeEq(headerToken, envToken);

  if (!isAdmin && !tokenOk) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = agent.rateLimitPerMin ?? 20;
  if (!checkAndConsume(agent.id, limit)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "Too many invocations" }, { status: 429 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const input = body && typeof body === "object" && "input" in (body as Record<string, unknown>)
    ? (body as { input: unknown }).input
    : body;

  const result = await invokeAgent(agent.codename, input, {
    source: tokenOk && !isAdmin ? "http" : "ui-console",
    callerUserId: me.id,
  });
  const status = result.ok ? 200 : 422;
  return NextResponse.json(result, { status });
}
