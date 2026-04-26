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

export const userCreateSchema = z.object({
  name: z.string().min(1).max(80),
  gender: z.enum(["female", "male", "other"]).optional().nullable(),
  level: z.number().int().min(1).max(999).default(1),
  token: z.string().min(8).max(128).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

export const userUpdateSchema = userCreateSchema.partial();

export const loginSchema = z.object({
  token: z.string().min(1),
});

export const profileUpdateSchema = z.object({
  bio: z.string().max(2000).optional().nullable(),
});

export const activityCreateSchema = z.object({
  content: z.string().min(1).max(280),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
