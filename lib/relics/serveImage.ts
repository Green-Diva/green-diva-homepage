import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { inferContentType } from "@/lib/relicStorage";

// HEIC = HEIF container with H.265 (HEVC) compression. Browsers other than
// Safari 16+ don't decode it natively, so endpoints serving relic assets
// transcode HEIC → JPEG on demand here. The converted bytes are cached
// next to the source as `<file>.heic.jpg`; subsequent requests skip the
// ~700ms decode and just stream the cached JPEG.
//
// Sharp's prebuilt libvips ships HEIF demuxing but no HEVC decoder (patent
// reasons), which is why we use heic-convert (WASM libheif) instead.

const HEIC_EXTS = new Set([".heic", ".heif"]);

// `Buffer<ArrayBuffer>` (a.k.a. NonSharedBuffer) is the type fs.readFile
// resolves to and the only Buffer flavour BodyInit accepts. The default
// `Buffer` alias is `Buffer<ArrayBufferLike>` which includes
// SharedArrayBuffer and won't typecheck against NextResponse.
export type ServedImage = { buf: Buffer<ArrayBuffer>; contentType: string };

export async function serveImageFile(abs: string): Promise<ServedImage> {
  const ext = path.extname(abs).toLowerCase();
  if (HEIC_EXTS.has(ext)) {
    const cachedAbs = abs + ".jpg";
    try {
      const cached = await fs.readFile(cachedAbs);
      return { buf: cached, contentType: "image/jpeg" };
    } catch {
      // cache miss — fall through to convert
    }
    const heicBuf = await fs.readFile(abs);
    // heic-convert is CJS with module.exports = fn. Dynamic import keeps
    // its sizable WASM out of bundles that don't serve images.
    const heicConvert = (await import("heic-convert")).default;
    const out = await heicConvert({
      buffer: heicBuf,
      format: "JPEG",
      quality: 0.85,
    });
    const jpegBuf = Buffer.from(out as ArrayBuffer);
    // Best-effort cache write; a failure here just means the next request
    // re-converts (e.g. read-only fs).
    fs.writeFile(cachedAbs, jpegBuf).catch((e) => {
      console.warn("[serveImage] cache write failed", { cachedAbs, e });
    });
    return { buf: jpegBuf, contentType: "image/jpeg" };
  }
  const buf = await fs.readFile(abs);
  return { buf, contentType: inferContentType(abs) };
}
