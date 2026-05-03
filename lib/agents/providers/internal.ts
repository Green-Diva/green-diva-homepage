import "server-only";
import { INTERNAL_HANDLERS, isHandlerRegistered } from "../internal/handlers";

export async function callInternal(handlerName: string | null | undefined, input: unknown): Promise<unknown> {
  if (!handlerName) throw new Error("internal handler name not configured");
  if (!isHandlerRegistered(handlerName)) {
    throw new Error(`internal handler not registered: ${handlerName}`);
  }
  const fn = INTERNAL_HANDLERS[handlerName];
  return fn(input);
}
