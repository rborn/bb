import { z } from "zod";

export const composerModeSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "ID must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(50),
  icon: z.string().min(1).max(30),
  color: z.union([z.enum(["slate", "emerald", "amber", "violet", "sky", "rose", "orange"]), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  description: z.string().max(200),
  promptPrefix: z.string().max(4096),
  permissionMode: z.enum(["full", "readOnly"]).default("full"),
  skills: z.array(z.string()).default([]),
  isBuiltin: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
});

export type ComposerMode = z.infer<typeof composerModeSchema>;

export const composerModesConfigSchema = z.object({
  modes: z.array(composerModeSchema),
  activeModeId: z.string().default("agent"),
});

export type ComposerModesConfig = z.infer<typeof composerModesConfigSchema>;
