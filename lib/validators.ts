import { z } from "zod";

export const projectCreateSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug only allows lowercase letters, digits, and hyphens"),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(280),
  description: z.string().min(1),
  coverUrl: z.string().url().optional().nullable(),
  tags: z.string().default(""),
  link: z.string().url().optional().nullable(),
  repoUrl: z.string().url().optional().nullable(),
  order: z.number().int().default(0),
  published: z.boolean().default(true),
});

export const projectUpdateSchema = projectCreateSchema.partial();

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
