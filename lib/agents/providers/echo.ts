import "server-only";

export async function callEcho(input: unknown): Promise<unknown> {
  return { echoed: input, ts: Date.now() };
}
