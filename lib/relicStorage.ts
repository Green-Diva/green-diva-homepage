import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";

export const RELIC_STORAGE_ROOT = path.join(process.cwd(), "private", "relics");

export function resolveRelicAsset(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  // strip leading slash so path.join treats it as relative
  const trimmed = relativePath.replace(/^[/\\]+/, "");
  const abs = path.resolve(RELIC_STORAGE_ROOT, trimmed);
  const root = path.resolve(RELIC_STORAGE_ROOT);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null; // path-traversal guard
  return abs;
}

export async function ensureStorageRoot(): Promise<void> {
  await fs.mkdir(RELIC_STORAGE_ROOT, { recursive: true });
}

export function inferContentType(p: string): string {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case ".glb":
      return "model/gltf-binary";
    case ".gltf":
      return "model/gltf+json";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}
