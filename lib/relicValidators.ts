import { z } from "zod";

export const RARITIES = ["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"] as const;

export const relicCreateSchema = z.object({
  slot: z.number().int().min(1).max(30),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  nameEn: z.string().min(1).max(120),
  nameZh: z.string().min(1).max(120),
  classifEn: z.string().min(1).max(160),
  classifZh: z.string().min(1).max(160),
  rarity: z.enum(RARITIES),
  iconKey: z.string().max(64).optional().nullable(),
  modelPath: z.string().max(512).optional().nullable(),
  photoPaths: z.array(z.string().max(512)).max(20).optional().default([]),
  loreEn: z.string().max(4000).optional().nullable(),
  loreZh: z.string().max(4000).optional().nullable(),
  acquiredAt: z.string().datetime().optional().nullable(),
  origin: z.string().max(160).optional().nullable(),
  password: z.string().min(4).max(128).optional().nullable(),
});

export const relicUpdateSchema = relicCreateSchema.partial();

export const unlockSchema = z.object({
  password: z.string().min(1).max(128),
});

export type RelicCreateInput = z.infer<typeof relicCreateSchema>;
export type RelicUpdateInput = z.infer<typeof relicUpdateSchema>;
