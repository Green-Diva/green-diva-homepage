// Unified error response shape for all /api/* routes.
//
// Why this exists:
//   Before 2026-05-11 the codebase had three error response shapes coexisting:
//     - { error: string }              (most routes — auth, validation, generic)
//     - { error: ZodFlattenResult }    (validators returning flatten() output)
//     - { ok: false, errorCode, errorMessage, ... }  (dry-run / sample-run)
//
//   Client code had to inspect both `.error` and `.errorCode` to figure out
//   which shape it got. Catch blocks couldn't be shared across endpoints.
//
//   This helper standardises every error response on one shape:
//     { ok: false, errorCode: string, errorMessage: string, error: string }
//
//   The trailing `error: string` is a back-compat alias of errorMessage so
//   any existing UI / fetch caller reading `.error` keeps working during
//   the migration window. Remove it after 2026-06 once all clients read
//   errorCode / errorMessage.
//
// Error code conventions (forward-only):
//   - SHOUTY_SNAKE_CASE: `<DOMAIN>_<STATE>`
//   - DOMAIN options: AUTH / VALIDATION / NOT_FOUND / CONFLICT / SCENE /
//     AGENT / SKILL / SLOT / SCHEMA / RUNTIME / PROVIDER / INTERNAL
//   - STATE options: REQUIRED / FORBIDDEN / FAILED / INVALID / MISSING /
//     EMPTY / OFFLINE / TIMEOUT / DISABLED / NOT_DEPLOYED
//   - Existing codes that don't match (TIMEOUT, INPUT_SCHEMA_VIOLATION,
//     HANDLER_ERROR, PROVIDER_ERROR) are grandfathered — don't rename in
//     this pass; doing so would break any catch-block doing string compare.
//     New codes added going forward MUST follow the convention.

import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { AgentErrorCode } from "@/lib/agent-errors";

export type ApiErrorBody = {
  ok: false;
  errorCode: AgentErrorCode;
  errorMessage: string;
  /** @deprecated back-compat alias for errorMessage. Removed after 2026-06. */
  error: string;
};

export function respondError(
  errorCode: AgentErrorCode,
  errorMessage: string,
  status: number,
): NextResponse {
  const body: ApiErrorBody = {
    ok: false,
    errorCode,
    errorMessage,
    error: errorMessage,
  };
  return NextResponse.json(body, { status });
}

// Specialisation for AuthError thrown by requireUser / requireAdmin —
// the same 4-line guard appears in every protected route.
export function respondAuthError(e: AuthError): NextResponse {
  return respondError(
    e.status === 401 ? AgentErrorCode.AUTH_REQUIRED : AgentErrorCode.AUTH_FORBIDDEN,
    e.message,
    e.status,
  );
}

// Specialisation for Zod validation failures. We forward the flatten()
// output as a structured field instead of stuffing it into `errorMessage`
// — that way clients showing inline field errors can still get the
// per-field map without parsing the human message.
export function respondValidationError(
  flatten: unknown,
  errorMessage = "validation failed",
  errorCode: AgentErrorCode = AgentErrorCode.VALIDATION_FAILED,
): NextResponse {
  const body: ApiErrorBody & { issues: unknown } = {
    ok: false,
    errorCode,
    errorMessage,
    error: errorMessage,
    issues: flatten,
  };
  return NextResponse.json(body, { status: 400 });
}
