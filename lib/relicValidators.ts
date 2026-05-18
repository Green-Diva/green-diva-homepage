import { z } from "zod";

export const RARITIES = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;

// Slug-scoped relative path inside private/relics (the /<slug>/... format
// emitted by handlers). Resolved server-side via resolveRelicAsset() which
// blocks path traversal — schema just enforces the surface shape.
const slugScopedPath = z.string().max(512).regex(/^\/[a-z0-9-]+\/[A-Za-z0-9_./-]+$/);

export const candidateImageSchema = z.object({
  path: slugScopedPath,
  source: z.enum(["user", "network"]),
  originalFilename: z.string().max(256).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  score: z.number().optional().default(0),
  deleted: z.boolean().optional().default(false),
});

export const relicCreateSchema = z.object({
  slot: z.number().int().min(1).max(60),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  nameEn: z.string().min(1).max(120),
  nameZh: z.string().min(1).max(120),
  classifEn: z.string().min(1).max(160),
  classifZh: z.string().min(1).max(160),
  rarity: z.enum(RARITIES),
  iconKey: z.string().max(64).optional().nullable(),
  modelPath: z.string().max(512).optional().nullable(),
  archivePath: z
    .string()
    .max(512)
    .regex(/^\/[a-z0-9-]+\/archive-\d+\.zip$/)
    .optional()
    .nullable(),
  derivedArchivePath: z
    .string()
    .max(512)
    .regex(/^\/[a-z0-9-]+\/derived-\d+\.zip$/)
    .optional()
    .nullable(),
  loreEn: z.string().max(4000).optional().nullable(),
  loreZh: z.string().max(4000).optional().nullable(),
  password: z.string().min(4).max(128).optional().nullable(),
  // Phase 5+ fields. Admin can edit them in the review UI.
  primaryImagePath: slugScopedPath.optional().nullable(),
  enhancedImages: z
    .array(
      z.object({
        path: slugScopedPath,
        sourceCandidatePath: z.string().min(1).max(512),
        model: z.string().min(1).max(64),
        operatingResolution: z.string().min(1).max(32),
        refineForeground: z.boolean(),
        createdAt: z.string().min(1).max(64),
        jobId: z.string().min(1).max(64).optional(),
      }),
    )
    .max(16)
    .optional()
    .nullable(),
  candidateImages: z.array(candidateImageSchema).max(40).optional().nullable(),
  materials: z
    .array(
      z.object({
        kind: z.enum(["webpage", "image", "document", "archive"]),
        url: z.string().url().max(2048).optional(),
        path: slugScopedPath.optional(),
        originalName: z.string().max(256).optional(),
        addedAt: z.string().max(64).optional(),
      }),
    )
    .max(20)
    .optional()
    .nullable(),
  // Status transitions: AWAITING_REVIEW → READY happens via the dedicated
  // /confirm endpoint, but admin can manually flip via PATCH too (e.g. to
  // re-park a relic to PARTIAL after a botched edit).
  status: z.enum(["DRAFT", "PROCESSING", "AWAITING_REVIEW", "READY", "PARTIAL", "FAILED"]).optional(),
});

export const relicUpdateSchema = relicCreateSchema.partial();

export const unlockSchema = z.object({
  password: z.string().min(1).max(128),
});

export type RelicCreateInput = z.infer<typeof relicCreateSchema>;
export type RelicUpdateInput = z.infer<typeof relicUpdateSchema>;
