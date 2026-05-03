import "server-only";
import type { AgentCapability } from "../types";
import { withInvocationLogging } from "../types";
import { getSecretOrEnv } from "@/lib/agentSecrets";

const ENDPOINT = "https://api.tavily.com/search";

export type WebResearchInput = {
  query: string;
  lang?: "en" | "zh";
  maxResults?: number;
};

export type ResearchSnippet = {
  url: string;
  title: string;
  content: string;
};

export type WebResearchOutput = {
  snippets: ResearchSnippet[];
};

const baseCapability: AgentCapability<WebResearchInput, WebResearchOutput> = {
  id: "web-research",
  agentCodename: "DIVA-001",
  metadata: {
    iconKey: "travel_explore",
    nameEn: "Sigil Scan",
    nameZh: "灵迹搜寻",
    descriptionEn: "Searches the open web for relevant snippets to anchor lore in real references.",
    descriptionZh: "在开放网络搜索相关片段，让 lore 写作有真实来源可依。",
    provider: "tavily",
    requiredEnvVars: ["TAVILY_API_KEY"],
  },
  serializeInput(input) {
    return { query: input.query, lang: input.lang ?? "en", maxResults: input.maxResults ?? 5 };
  },
  serializeOutput(output) {
    return {
      count: output.snippets.length,
      domains: Array.from(new Set(output.snippets.map((s) => safeHostname(s.url)))).slice(0, 8),
    };
  },
  async run(_agent, input) {
    const key = await getSecretOrEnv("TAVILY_API_KEY");
    if (!key) throw new Error("TAVILY_API_KEY not configured");
    const max = Math.max(1, Math.min(10, input.maxResults ?? 5));

    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: input.query.slice(0, 400),
        search_depth: "basic",
        max_results: max,
        include_raw_content: false,
        include_answer: false,
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`tavily ${r.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await r.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const snippets: ResearchSnippet[] = (json.results ?? [])
      .filter((x) => typeof x.url === "string" && typeof x.content === "string")
      .map((x) => ({
        url: String(x.url),
        title: String(x.title ?? "").slice(0, 200),
        content: String(x.content ?? "").slice(0, 1500),
      }));
    return { snippets };
  },
};

export const webResearchCapability = withInvocationLogging(baseCapability);

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unknown)";
  }
}
