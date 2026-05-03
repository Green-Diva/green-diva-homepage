import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAdmin } from "@/lib/auth";
import { listSecretStatus, setSecret } from "@/lib/agentSecrets";
import { ALL_KNOWN_CAPABILITY_SECRETS, isKnownSecretName } from "@/lib/agents/knownSecrets";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const list = await listSecretStatus(ALL_KNOWN_CAPABILITY_SECRETS);
  return NextResponse.json({ secrets: list });
}

const bodySchema = z.object({
  name: z.string().min(1).max(64),
  value: z.string().min(1).max(4096),
});

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!isKnownSecretName(parsed.data.name)) {
    return NextResponse.json({ error: "unknown secret name" }, { status: 400 });
  }

  try {
    await setSecret(parsed.data.name, parsed.data.value, me.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/agent-secrets POST] failed", e);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}
