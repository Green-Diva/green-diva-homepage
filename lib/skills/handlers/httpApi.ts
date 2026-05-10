// HTTP_API handler — generic REST caller. Reads handlerConfig:
//   {
//     method?: string,                     // default "POST"
//     url: string,                         // can contain {{vars}} (input scope)
//     authEnv?: string,                    // env name; resolved server-side
//     authScheme?: "Bearer"|"ApiKey"|"Key"|"Basic"|"Header"|"QueryParam",
//                                          // default "Bearer"
//     authHeader?: string,                 // for scheme=Header (default "X-API-Key")
//     authQueryParam?: string,             // for scheme=QueryParam (default "api_key");
//                                          //   appended to the resolved URL as ?<param>=<envvalue>.
//                                          //   Used by APIs like SerpAPI that authenticate via query.
//     headers?: Record<string,string>,
//     queryTemplate?: Record<string,string>, // values may contain {{vars}}
//     bodyTemplate?: unknown,              // any JSON; strings get {{var}} interpolation.
//                                          // If absent, raw `input` is sent as JSON body.
//     timeoutMs?: number,                  // default 30_000
//     responseType?: "json" | "text" | "binary",
//                                          // default "json"; "binary" returns
//                                          //   { base64, contentType, bytes, url }
//                                          //   for direct image / blob fetches
//                                          //   (forEach-over-URLs flows). Polling
//                                          //   is incompatible with binary mode.
//
//     // — Phase 2.2 additions — — — — — — — — — — — — — — — — — — — — —
//
//     polling?: {                          // poll for async-task completion.
//       url: string,                       // can reference {{input.X}} + {{response.Y}}
//       method?: string,                   // default "GET"
//       headers?: Record<string,string>,
//       intervalMs?: number,               // default 5_000
//       timeoutMs?: number,                // default 600_000 (10min)
//       successWhen: Condition,            // terminate poll loop & return response
//       failureWhen?: Condition | Condition[], // terminate poll loop & throw
//     },
//
//     responseTransform?: unknown,         // template applied AFTER polling/download
//                                          //   to reshape the response. Variable
//                                          //   scope is { input, response }.
//                                          //   Example:
//                                          //     { candidates: "{{response.images}}" }
//
//     download?: {                         // when the (post-poll) response carries a
//                                          //   URL, fetch it and attach as a field
//                                          //   under the response BEFORE responseTransform.
//                                          //   Used for "submit task → poll → download
//                                          //   GLB" flows. Returned data is base64 so
//                                          //   the next skill can persist it via the
//                                          //   internal save-asset endpoint.
//       urlPath: string,                   // dot-path inside response, e.g. "model_urls.glb"
//       field?: string,                    // key to attach result to (default "_download")
//       maxBytes?: number,                 // default 50 MB
//     }
//   }
//
// Template variable scopes (the inconsistency is intentional, kept for
// backward compat with existing skills):
//   - url / queryTemplate / bodyTemplate / headers: variable scope is the
//     RAW skill input. So {{relicSlug}} resolves input.relicSlug.
//   - polling.url / polling.headers / responseTransform: scope is wrapped
//     as { input, response }. Use {{input.relicSlug}} and {{response.taskId}}.
//   New skills should prefer the wrapped style consistently — Phase 3 UI
//   will hide the raw style behind a typed form so the inconsistency
//   stops mattering.

import { HandlerError, type SkillHandler } from "../types";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_DOWNLOAD_FIELD = "_download";

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

function applyTemplate(template: unknown, scope: unknown): unknown {
  if (typeof template === "string") {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g, (_m, path: string) => {
      const v = getPath(scope, path);
      if (v === undefined || v === null) return "";
      return typeof v === "string" ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(template)) return template.map((t) => applyTemplate(t, scope));
  if (isObject(template)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(template)) out[k] = applyTemplate(template[k], scope);
    return out;
  }
  return template;
}

// — Polling helpers — — — — — — — — — — — — — — — — — — — — — — — — — —

type Condition = { path: string; equals: unknown };

function isCondition(v: unknown): v is Condition {
  return isObject(v) && typeof v.path === "string" && "equals" in v;
}

function matchesCondition(response: unknown, cond: Condition): boolean {
  return getPath(response, cond.path) === cond.equals;
}

function matchesAny(response: unknown, conds: Condition | Condition[] | undefined): boolean {
  if (!conds) return false;
  const arr = Array.isArray(conds) ? conds : [conds];
  return arr.some((c) => matchesCondition(response, c));
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Resolved auth — either an Authorization-style header or a query
// parameter to append. Polling reuses the headers piece so iterations
// stay authenticated; query-param auth is initial-request-only because
// every poll target redefines its own URL via `polling.url`.
type ResolvedAuth = {
  headers: Record<string, string>;
  queryParam?: { name: string; value: string };
};

function resolveAuth(config: Record<string, unknown>): ResolvedAuth {
  const out: ResolvedAuth = { headers: {} };
  if (typeof config.authEnv !== "string" || !config.authEnv) return out;
  const key = process.env[config.authEnv];
  if (!key) {
    throw new HandlerError(`HTTP_API: env "${config.authEnv}" not set on server`, "MISSING_ENV");
  }
  const scheme = (typeof config.authScheme === "string" ? config.authScheme : "Bearer") as
    | "Bearer"
    | "ApiKey"
    | "Key"
    | "Basic"
    | "Header"
    | "QueryParam";
  if (scheme === "Bearer") out.headers["Authorization"] = `Bearer ${key}`;
  else if (scheme === "ApiKey") out.headers["Authorization"] = `ApiKey ${key}`;
  // "Key" is the fal.ai convention (`Authorization: Key <key>`). Distinct
  // from "ApiKey" because the literal prefix word differs.
  else if (scheme === "Key") out.headers["Authorization"] = `Key ${key}`;
  else if (scheme === "Basic") out.headers["Authorization"] = `Basic ${key}`;
  else if (scheme === "Header") {
    const h = typeof config.authHeader === "string" ? config.authHeader : "X-API-Key";
    out.headers[h] = key;
  } else if (scheme === "QueryParam") {
    const name = typeof config.authQueryParam === "string" ? config.authQueryParam : "api_key";
    out.queryParam = { name, value: key };
  }
  return out;
}

// Single fetch with timeout + JSON-or-text decode. Used by both initial
// request and polling iterations.
async function fetchOnce(opts: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  responseType: "json" | "text" | "binary";
  // Binary mode caps response size to keep memory bounded. Defaulted by
  // caller; required when responseType === "binary".
  binaryMaxBytes?: number;
}): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: ac.signal,
    });
  } catch (e) {
    if (ac.signal.aborted) {
      throw new HandlerError(`HTTP_API: timeout after ${opts.timeoutMs}ms`, "TIMEOUT");
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

  if (opts.responseType === "text") return await res.text();
  if (opts.responseType === "binary") {
    const buf = Buffer.from(await res.arrayBuffer());
    const cap = opts.binaryMaxBytes ?? DEFAULT_DOWNLOAD_MAX_BYTES;
    if (buf.byteLength > cap) {
      throw new HandlerError(
        `HTTP_API: binary response exceeded maxBytes (${buf.byteLength} > ${cap})`,
        "OUTPUT_PARSE",
      );
    }
    return {
      base64: buf.toString("base64"),
      contentType: res.headers.get("content-type") || "application/octet-stream",
      bytes: buf.byteLength,
      url: opts.url,
    };
  }
  try {
    return await res.json();
  } catch {
    throw new HandlerError("HTTP_API: response is not valid JSON", "OUTPUT_PARSE");
  }
}

async function pollUntilDone(opts: {
  initialResponse: unknown;
  input: unknown;
  config: Record<string, unknown>;
  authHeaders: Record<string, string>;
  responseType: "json" | "text";
  perRequestTimeoutMs: number;
}): Promise<unknown> {
  const polling = isObject(opts.config.polling) ? opts.config.polling : null;
  if (!polling) return opts.initialResponse;

  const successCond = isCondition(polling.successWhen) ? polling.successWhen : null;
  if (!successCond) {
    throw new HandlerError(
      "HTTP_API: polling.successWhen is required and must be { path, equals }",
      "INVALID_CONFIG",
    );
  }
  const failureCond = polling.failureWhen as Condition | Condition[] | undefined;

  // If the initial response already satisfies a terminal condition, we're done.
  if (matchesCondition(opts.initialResponse, successCond)) return opts.initialResponse;
  if (matchesAny(opts.initialResponse, failureCond)) {
    throw new HandlerError(
      `HTTP_API: polling failed before first poll — initial response matched failureWhen`,
      "PROVIDER_ERROR",
    );
  }

  const pollUrlTemplate = typeof polling.url === "string" ? polling.url : null;
  if (!pollUrlTemplate) {
    throw new HandlerError("HTTP_API: polling.url is required", "INVALID_CONFIG");
  }
  const pollMethod = (typeof polling.method === "string" ? polling.method : "GET").toUpperCase();
  const intervalMs =
    typeof polling.intervalMs === "number" ? polling.intervalMs : DEFAULT_POLL_INTERVAL_MS;
  const overallDeadline =
    Date.now() +
    (typeof polling.timeoutMs === "number" ? polling.timeoutMs : DEFAULT_POLL_TIMEOUT_MS);
  const pollExtraHeaders = isObject(polling.headers)
    ? Object.fromEntries(Object.entries(polling.headers).map(([k, v]) => [k, String(v)]))
    : {};

  // Each poll iteration uses the LATEST response as the {{response.X}}
  // scope so URL templates that need the task id from the first response
  // (or any iterating field) keep resolving correctly.
  let lastResponse = opts.initialResponse;
  while (Date.now() < overallDeadline) {
    await sleep(intervalMs);
    const scope = { input: opts.input, response: lastResponse };
    const url = String(applyTemplate(pollUrlTemplate, scope));
    const headers = {
      ...opts.authHeaders,
      ...applyTemplate(pollExtraHeaders, scope) as Record<string, string>,
    };
    lastResponse = await fetchOnce({
      url,
      method: pollMethod,
      headers,
      timeoutMs: opts.perRequestTimeoutMs,
      responseType: opts.responseType,
    });
    if (matchesCondition(lastResponse, successCond)) return lastResponse;
    if (matchesAny(lastResponse, failureCond)) {
      const reason =
        getPath(lastResponse, "task_error.message") ??
        getPath(lastResponse, "error") ??
        "matched failureWhen";
      throw new HandlerError(
        `HTTP_API: polling failed (${String(reason).slice(0, 200)})`,
        "PROVIDER_ERROR",
      );
    }
  }
  throw new HandlerError(
    `HTTP_API: polling timed out after ${typeof polling.timeoutMs === "number" ? polling.timeoutMs : DEFAULT_POLL_TIMEOUT_MS}ms`,
    "TIMEOUT",
  );
}

// Pull a URL from inside the response, fetch the bytes, return base64 +
// content-type. Returns null if download.urlPath isn't configured (no-op).
async function maybeDownload(
  response: unknown,
  config: Record<string, unknown>,
): Promise<{
  base64: string;
  contentType: string;
  bytes: number;
  url: string;
} | null> {
  const dl = isObject(config.download) ? config.download : null;
  if (!dl) return null;

  const urlPath = typeof dl.urlPath === "string" ? dl.urlPath : null;
  if (!urlPath) {
    throw new HandlerError("HTTP_API: download.urlPath is required", "INVALID_CONFIG");
  }
  const url = getPath(response, urlPath);
  if (typeof url !== "string" || !url) {
    throw new HandlerError(
      `HTTP_API: download.urlPath "${urlPath}" did not resolve to a string URL in the response`,
      "OUTPUT_PARSE",
    );
  }
  const maxBytes =
    typeof dl.maxBytes === "number" ? dl.maxBytes : DEFAULT_DOWNLOAD_MAX_BYTES;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new HandlerError(
      `HTTP_API: download fetch failed${e instanceof Error ? ": " + e.message : ""}`,
      "HTTP_ERROR",
    );
  }
  if (!res.ok) {
    throw new HandlerError(
      `HTTP_API: download HTTP ${res.status} ${res.statusText}`,
      "HTTP_ERROR",
      res.status,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new HandlerError(
      `HTTP_API: download exceeded maxBytes (${buf.byteLength} > ${maxBytes})`,
      "OUTPUT_PARSE",
    );
  }
  return {
    base64: buf.toString("base64"),
    contentType: res.headers.get("content-type") || "application/octet-stream",
    bytes: buf.byteLength,
    url,
  };
}

export const httpApi: SkillHandler = async (input, config) => {
  const url = typeof config.url === "string" ? config.url : null;
  if (!url) throw new HandlerError("HTTP_API: url missing in handlerConfig", "INVALID_CONFIG");

  const method = (typeof config.method === "string" ? config.method : "POST").toUpperCase();
  const headers: Record<string, string> = isObject(config.headers)
    ? Object.fromEntries(Object.entries(config.headers).map(([k, v]) => [k, String(v)]))
    : {};

  const auth = resolveAuth(config);
  Object.assign(headers, auth.headers);

  // URL with optional query template — uses raw input scope (legacy convention).
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
  // QueryParam-scheme auth: append the env-resolved key as a query parameter.
  // Done after queryTemplate so handlerConfig admins can't accidentally
  // override it with a literal value.
  if (auth.queryParam) {
    const sep = resolvedUrl.includes("?") ? "&" : "?";
    resolvedUrl +=
      sep +
      encodeURIComponent(auth.queryParam.name) +
      "=" +
      encodeURIComponent(auth.queryParam.value);
  }

  // Body (legacy: raw input scope)
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

  const timeoutMs = typeof config.timeoutMs === "number" ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const responseType: "json" | "text" | "binary" =
    config.responseType === "text"
      ? "text"
      : config.responseType === "binary"
        ? "binary"
        : "json";
  // Binary mode and polling are mutually exclusive: polling needs a JSON
  // status field to read, and the success/failure conditions don't make
  // sense over a raw blob. Catch this at the boundary so admins don't
  // get confusing errors mid-poll.
  if (responseType === "binary" && isObject(config.polling)) {
    throw new HandlerError(
      "HTTP_API: responseType=\"binary\" cannot be combined with polling",
      "INVALID_CONFIG",
    );
  }
  const binaryMaxBytes =
    typeof config.binaryMaxBytes === "number" ? config.binaryMaxBytes : undefined;

  // Initial request.
  const initialResponse = await fetchOnce({
    url: resolvedUrl,
    method,
    headers,
    body,
    timeoutMs,
    responseType,
    binaryMaxBytes,
  });

  // Polling (no-op if not configured). Binary + polling combo was
  // rejected at the boundary above, so responseType narrows to text/json
  // here; cast keeps the pollUntilDone signature simple.
  const settled = await pollUntilDone({
    initialResponse,
    input,
    config,
    authHeaders: auth.headers,
    responseType: responseType === "binary" ? "json" : responseType,
    perRequestTimeoutMs: timeoutMs,
  });

  // Download (no-op if not configured). Attach to a sibling field on the
  // settled response so responseTransform can splice/forward it.
  const dlResult = isObject(settled) ? await maybeDownload(settled, config) : null;
  let withDownload: unknown = settled;
  if (dlResult && isObject(settled)) {
    const fieldName =
      isObject(config.download) && typeof config.download.field === "string"
        ? config.download.field
        : DEFAULT_DOWNLOAD_FIELD;
    withDownload = { ...settled, [fieldName]: dlResult };
  }

  // Optional response reshape. Scope is { input, response } — admin uses
  // {{response.X}} to pull from the (possibly-downloaded) response.
  if (config.responseTransform !== undefined && config.responseTransform !== null) {
    return applyTemplate(config.responseTransform, { input, response: withDownload });
  }

  return withDownload;
};
