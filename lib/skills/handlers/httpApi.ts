// HTTP_API handler — generic REST caller. Reads handlerConfig:
//   {
//     method?: string,                     // default "POST"
//     url: string,                         // can contain {{vars}}
//     authEnv?: string,                    // env name; resolved server-side
//     authScheme?: "Bearer"|"ApiKey"|"Basic"|"Header",  // default "Bearer"
//     authHeader?: string,                 // for scheme=Header (default "X-API-Key")
//     headers?: Record<string,string>,
//     queryTemplate?: Record<string,string>, // values may contain {{vars}}
//     bodyTemplate?: unknown,              // any JSON; strings get {{var}} interpolation.
//                                          // If absent, raw `input` is sent as JSON body.
//     timeoutMs?: number,                  // default 30_000
//     responseType?: "json" | "text",      // default "json"
//   }

import { HandlerError, type SkillHandler } from "../types";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function applyTemplate(template: unknown, input: unknown): unknown {
  if (typeof template === "string") {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g, (_m, path: string) => {
      const v = getPath(input, path);
      if (v === undefined || v === null) return "";
      return typeof v === "string" ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(template)) return template.map((t) => applyTemplate(t, input));
  if (isObject(template)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(template)) out[k] = applyTemplate(template[k], input);
    return out;
  }
  return template;
}

export const httpApi: SkillHandler = async (input, config) => {
  const url = typeof config.url === "string" ? config.url : null;
  if (!url) throw new HandlerError("HTTP_API: url missing in handlerConfig", "INVALID_CONFIG");

  const method = (typeof config.method === "string" ? config.method : "POST").toUpperCase();
  const headers: Record<string, string> = isObject(config.headers)
    ? Object.fromEntries(Object.entries(config.headers).map(([k, v]) => [k, String(v)]))
    : {};

  // Auth via env
  if (typeof config.authEnv === "string" && config.authEnv) {
    const key = process.env[config.authEnv];
    if (!key) throw new HandlerError(`HTTP_API: env "${config.authEnv}" not set on server`, "MISSING_ENV");
    const scheme = (typeof config.authScheme === "string" ? config.authScheme : "Bearer") as
      | "Bearer"
      | "ApiKey"
      | "Basic"
      | "Header";
    if (scheme === "Bearer") headers["Authorization"] = `Bearer ${key}`;
    else if (scheme === "ApiKey") headers["Authorization"] = `ApiKey ${key}`;
    else if (scheme === "Basic") headers["Authorization"] = `Basic ${key}`;
    else if (scheme === "Header") {
      const h = typeof config.authHeader === "string" ? config.authHeader : "X-API-Key";
      headers[h] = key;
    }
  }

  // URL with optional query template
  let resolvedUrl = String(applyTemplate(url, input));
  if (isObject(config.queryTemplate)) {
    const qsObj = applyTemplate(config.queryTemplate, input) as Record<string, unknown>;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(qsObj)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) resolvedUrl += (resolvedUrl.includes("?") ? "&" : "?") + s;
  }

  // Body
  const hasBody = method !== "GET" && method !== "HEAD";
  let body: string | undefined;
  if (hasBody) {
    const resolved = config.bodyTemplate !== undefined
      ? applyTemplate(config.bodyTemplate, input)
      : input;
    body = JSON.stringify(resolved ?? null);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const timeoutMs = typeof config.timeoutMs === "number" ? config.timeoutMs : 30_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(resolvedUrl, { method, headers, body, signal: ac.signal });
  } catch (e) {
    if (ac.signal.aborted) {
      throw new HandlerError(`HTTP_API: timeout after ${timeoutMs}ms`, "TIMEOUT");
    }
    throw new HandlerError(
      `HTTP_API: fetch failed${e instanceof Error ? ": " + e.message : ""}`,
      "HTTP_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HandlerError(
      `HTTP_API: ${res.status} ${res.statusText}${text ? " — " + text.slice(0, 200) : ""}`,
      "HTTP_ERROR",
      res.status,
    );
  }

  const responseType = config.responseType === "text" ? "text" : "json";
  if (responseType === "text") return await res.text();
  try {
    return await res.json();
  } catch {
    throw new HandlerError("HTTP_API: response is not valid JSON", "OUTPUT_PARSE");
  }
};
