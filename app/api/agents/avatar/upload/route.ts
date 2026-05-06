import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { AuthError, requireAdmin } from "@/lib/auth";

const STORAGE_DIR = path.join(
  process.cwd(),
  "public",
  "images",
  "machine-agent",
  "avatars",
);

export async function POST(req: NextRequest) {
  try {
    try {
      await requireAdmin();
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "invalid form" }, { status: 400 });

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    // Trust the client-cropped output; default to .jpg if no extension is given.
    const rawExt = path.extname(file.name).toLowerCase();
    const ext = rawExt && rawExt.length <= 5 ? rawExt : ".jpg";

    await fs.mkdir(STORAGE_DIR, { recursive: true });
    const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    const abs = path.join(STORAGE_DIR, fname);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(abs, buf);

    const url = `/images/machine-agent/avatars/${fname}`;
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[api/agents/avatar/upload] failed", e);
    return NextResponse.json(
      { error: `upload error: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
