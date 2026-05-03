import { NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { deleteSecret } from "@/lib/agentSecrets";
import { isKnownSecretName } from "@/lib/agents/knownSecrets";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { name } = await ctx.params;
  if (!isKnownSecretName(name)) {
    return NextResponse.json({ error: "unknown secret name" }, { status: 400 });
  }
  try {
    await deleteSecret(name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/agent-secrets DELETE] failed", e);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
