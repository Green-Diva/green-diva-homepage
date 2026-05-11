import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { skillCreateSchema } from "@/lib/validators";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";

// Derive a kebab-case slug candidate from the human-readable nameEn. Mirrors
// the regex enforced by skillSlugSchema. Collisions are resolved by appending
// a short id-derived suffix in deriveUniqueSlug below.
function slugCandidate(nameEn: string): string {
  const base = nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return base || "skill";
}

async function deriveUniqueSlug(nameEn: string): Promise<string> {
  const base = slugCandidate(nameEn);
  // Try the bare slug first, then suffix with a 4-char random tail until
  // we find one nobody owns. 5 tries cover any realistic admin scenario.
  for (let i = 0; i < 6; i += 1) {
    const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const taken = await prisma.skill.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Pathological — fall back to base + timestamp.
  return `${base}-${Date.now().toString(36)}`.slice(0, 64);
}

// Convert validator output to Prisma write shape. Json fields need
// Prisma.JsonNull when caller explicitly sets null (Prisma rejects raw null
// for non-nullable Json columns; for nullable ones it would be misinterpreted
// as JsonNullValueInput.JsonNull anyway — see CLAUDE.md "Prisma 写入陷阱").
function buildJsonWrites(parsed: {
  handlerConfig?: Record<string, unknown>;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
}) {
  const writes: {
    handlerConfig?: Prisma.InputJsonValue;
    inputSchema?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    outputSchema?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  } = {};
  if (parsed.handlerConfig !== undefined) {
    writes.handlerConfig = parsed.handlerConfig as Prisma.InputJsonValue;
  }
  if (parsed.inputSchema !== undefined) {
    writes.inputSchema = parsed.inputSchema === null
      ? Prisma.JsonNull
      : (parsed.inputSchema as Prisma.InputJsonValue);
  }
  if (parsed.outputSchema !== undefined) {
    writes.outputSchema = parsed.outputSchema === null
      ? Prisma.JsonNull
      : (parsed.outputSchema as Prisma.InputJsonValue);
  }
  return writes;
}

export async function GET() {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }
  const skills = await prisma.skill.findMany({
    orderBy: [{ level: "asc" }, { kind: "asc" }],
    include: { createdBy: { select: { id: true, name: true } } },
  });
  return NextResponse.json(skills);
}

export async function POST(req: NextRequest) {
  let me;
  try {
    me = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return respondAuthError(e);
    throw e;
  }

  const json = await req.json().catch(() => null);
  const parsed = skillCreateSchema.safeParse(json);
  if (!parsed.success) {
    return respondValidationError(parsed.error.flatten());
  }

  const { handlerConfig, inputSchema, outputSchema, slug: providedSlug, ...rest } = parsed.data;
  const jsonWrites = buildJsonWrites({ handlerConfig, inputSchema, outputSchema });

  // Auto-derive slug when admin doesn't provide one. Manual slugs are
  // preferred (stable across nameEn renames) but optional during rollout.
  const slug = providedSlug ?? (await deriveUniqueSlug(rest.nameEn));

  try {
    const skill = await prisma.skill.create({
      data: { ...rest, slug, ...jsonWrites, createdById: me.id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json(skill, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return respondError("SKILL_SLUG_CONFLICT", "slug already in use", 409);
    }
    console.error("[skills] create failed", e);
    return respondError("CREATE_FAILED", "create failed", 500);
  }
}
