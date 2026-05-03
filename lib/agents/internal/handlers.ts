import "server-only";

export type InternalHandler = (input: unknown) => Promise<unknown>;

export const INTERNAL_HANDLERS: Record<string, InternalHandler> = {};

export function isHandlerRegistered(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(INTERNAL_HANDLERS, name);
}
