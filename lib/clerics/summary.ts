import "server-only";
import { prisma } from "@/lib/db";
import { listAgentCapabilities, getRawCapability } from "./registry";
import { getConfiguredSecretNames } from "@/lib/agentSecrets";
import type { CapabilityStats, CapabilitySummary } from "./capabilityTypes";

export type { CapabilityStats, CapabilitySummary };

const RECENT_INVOCATION_WINDOW = 20;

const EMPTY_STATS: CapabilityStats = {
  total: 0,
  successful: 0,
  failed: 0,
  avgLatencyMs: null,
  last: null,
};

export async function getCapabilitySummariesForAgent(
  codename: string,
  agentId: string,
): Promise<CapabilitySummary[]> {
  const ids = listAgentCapabilities(codename);
  if (ids.length === 0) return [];

  const allRequiredEnvVars = new Set<string>();
  for (const id of ids) {
    const cap = getRawCapability(codename, id);
    for (const v of cap.metadata.requiredEnvVars) allRequiredEnvVars.add(v);
  }

  const [recent, configuredSecrets] = await Promise.all([
    prisma.agentInvocation.findMany({
      where: { agentId, source: { in: ids.map((id) => `capability:${id}`) } },
      orderBy: { createdAt: "desc" },
      take: RECENT_INVOCATION_WINDOW * ids.length,
      select: { source: true, ok: true, latencyMs: true, createdAt: true },
    }),
    getConfiguredSecretNames(Array.from(allRequiredEnvVars)),
  ]);

  const bySource = new Map<string, typeof recent>();
  for (const inv of recent) {
    const arr = bySource.get(inv.source) ?? [];
    if (arr.length < RECENT_INVOCATION_WINDOW) {
      arr.push(inv);
      bySource.set(inv.source, arr);
    }
  }

  return ids.map((id) => {
    const cap = getRawCapability(codename, id);
    const meta = cap.metadata;
    const missingEnvVars = meta.requiredEnvVars.filter((k) => !configuredSecrets.has(k));
    const invs = bySource.get(`capability:${id}`) ?? [];
    return {
      id,
      agentCodename: codename,
      metadata: meta,
      envOk: missingEnvVars.length === 0,
      missingEnvVars,
      stats: invs.length === 0 ? EMPTY_STATS : aggregate(invs),
    };
  });
}

export async function getCapabilitySummariesByAgent(
  agents: Array<{ id: string; codename: string }>,
): Promise<Record<string, CapabilitySummary[]>> {
  const out: Record<string, CapabilitySummary[]> = {};
  await Promise.all(
    agents.map(async (a) => {
      out[a.codename] = await getCapabilitySummariesForAgent(a.codename, a.id);
    }),
  );
  return out;
}

function aggregate(
  invs: Array<{ ok: boolean; latencyMs: number | null; createdAt: Date }>,
): CapabilityStats {
  let successful = 0;
  let failed = 0;
  let latencySum = 0;
  let latencyCount = 0;
  for (const inv of invs) {
    if (inv.ok) successful++;
    else failed++;
    if (inv.latencyMs != null) {
      latencySum += inv.latencyMs;
      latencyCount++;
    }
  }
  const last = invs[0]
    ? { ok: invs[0].ok, latencyMs: invs[0].latencyMs, createdAt: invs[0].createdAt.toISOString() }
    : null;
  return {
    total: invs.length,
    successful,
    failed,
    avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
    last,
  };
}
