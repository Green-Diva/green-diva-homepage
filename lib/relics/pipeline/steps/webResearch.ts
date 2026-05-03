import "server-only";
import { webResearchCapability } from "@/lib/agents/diva-001/web-research";
import { getSecretOrEnv } from "@/lib/agentSecrets";
import type { PipelineContext, StepResult } from "../context";
import type { StructuredFieldsResult } from "./structuredFields";

export type ResearchSnippet = {
  url: string;
  title: string;
  content: string;
};

export type WebResearchResult = {
  snippets: ResearchSnippet[];
  status: "succeeded" | "skipped";
  reason?: string;
  query?: string;
};

export async function stepWebResearch(
  ctx: PipelineContext,
): Promise<StepResult<WebResearchResult>> {
  if (!(await getSecretOrEnv("TAVILY_API_KEY"))) {
    return {
      ok: true,
      data: { snippets: [], status: "skipped", reason: "TAVILY_API_KEY not configured" },
    };
  }

  const fields = ctx.results.get("STRUCTURED_FIELDS") as StructuredFieldsResult | undefined;
  const description = ctx.relic.draftNote ?? "";
  const queryParts = [
    fields?.nameEn,
    fields?.classifEn,
    description.slice(0, 200),
  ].filter((s): s is string => !!s && s.trim().length > 0);
  const query = queryParts.join(" — ").trim() || ctx.relic.nameEn;

  try {
    const out = await webResearchCapability.run(ctx.agent, { query, maxResults: 5 });
    return {
      ok: true,
      data: { snippets: out.snippets, status: "succeeded", query },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[pipeline/webResearch] capability failed", msg);
    return {
      ok: true,
      data: { snippets: [], status: "skipped", reason: msg.slice(0, 200), query },
    };
  }
}
