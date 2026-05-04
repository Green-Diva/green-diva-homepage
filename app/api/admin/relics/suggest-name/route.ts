import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSecretOrEnv } from "@/lib/clericSecrets";
import {
  parseImageDataUrl,
  structuredNamingCapability,
  type StructuredNamingImage,
} from "@/lib/clerics/diva-001/structured-naming";

// Per-IP rate limit (in-memory; single-instance only — see CLAUDE.md note).
const FAIL_DELAY_MS = 600;
const MAX_PER_WINDOW = 12;
const WINDOW_MS = 60_000;
const calls = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || "unknown").slice(0, 64);
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const cur = calls.get(key);
  if (!cur || cur.resetAt < now) {
    calls.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > MAX_PER_WINDOW;
}

const bodySchema = z.object({
  description: z.string().max(2000).default(""),
  // ~6MB cap on data URL to keep memory bounded
  imageDataUrl: z
    .string()
    .max(6 * 1024 * 1024)
    .regex(/^data:image\/(jpeg|png|webp|gif);base64,/)
    .optional()
    .nullable(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const key = clientKey(req);
  if (rateLimited(key)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "rate-limited" }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!parsed.data.description.trim() && !parsed.data.imageDataUrl) {
    return NextResponse.json({ error: "need description or image" }, { status: 400 });
  }

  if (!(await getSecretOrEnv("ANTHROPIC_API_KEY"))) {
    return NextResponse.json({ error: "ai-not-configured" }, { status: 503 });
  }

  const diva = await prisma.cleric.findUnique({
    where: { codename: structuredNamingCapability.clericCodename },
  });
  if (!diva || !diva.enabled || diva.status === "OFFLINE") {
    return NextResponse.json({ error: "cleric-unavailable" }, { status: 503 });
  }

  const images: StructuredNamingImage[] = [];
  if (parsed.data.imageDataUrl) {
    const img = parseImageDataUrl(parsed.data.imageDataUrl);
    if (img) images.push(img);
  }

  try {
    const out = await structuredNamingCapability.run(diva, {
      description: parsed.data.description,
      images,
    });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[ai/suggest-name] failed", e);
    return NextResponse.json({ error: "ai-failed" }, { status: 502 });
  }
}
