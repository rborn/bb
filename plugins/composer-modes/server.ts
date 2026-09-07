import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { defaultModes } from "./default-modes.js";
import { composerModeSchema, composerModesConfigSchema, type ComposerMode } from "./types.js";

const STORAGE_KEY = "composer-modes:v1";
const REALTIME_CHANNEL = "composer-modes:changed";

const modeInputSchema = composerModeSchema.omit({ isBuiltin: true }).extend({
  isBuiltin: z.boolean().optional().default(false),
});

export const composerModesRpcContract = defineRpcContract({
  getModes: {
    input: z.null(),
    output: z.object({
      modes: z.array(composerModeSchema),
      activeModeId: z.string(),
    }),
  },
  saveMode: {
    input: modeInputSchema,
    output: z.object({ mode: composerModeSchema }),
  },
  deleteMode: {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  toggleMode: {
    input: z.object({ id: z.string(), isEnabled: z.boolean() }),
    output: z.object({ mode: composerModeSchema }),
  },
  setActiveMode: {
    input: z.object({ id: z.string(), threadId: z.string().optional() }),
    output: z.object({ activeModeId: z.string() }),
  },
});



type RpcContract = typeof composerModesRpcContract;

async function loadConfig(kv: BbPluginApi["storage"]["kv"]): Promise<{
  modes: ComposerMode[];
  activeModeId: string;
}> {
  const raw = await kv.get<unknown>(STORAGE_KEY);
  if (raw === undefined) {
    return { modes: [...defaultModes], activeModeId: "agent" };
  }
  const parsed = composerModesConfigSchema.safeParse(raw);
  if (!parsed.success || parsed.data.modes.length === 0) {
    return { modes: [...defaultModes], activeModeId: "agent" };
  }
  const modes = parsed.data.modes;
  const activeExists = modes.some((m) => m.id === parsed.data.activeModeId);
  return {
    modes,
    activeModeId: activeExists ? parsed.data.activeModeId : (modes[0]?.id ?? "agent"),
  };
}

async function saveConfig(
  kv: BbPluginApi["storage"]["kv"],
  config: { modes: ComposerMode[]; activeModeId: string },
): Promise<void> {
  await kv.set(STORAGE_KEY, config);
}

export default async function plugin(bb: BbPluginApi) {
  let cached: { modes: ComposerMode[]; activeModeId: string } | null = null;

  async function getConfig(): Promise<{ modes: ComposerMode[]; activeModeId: string }> {
    if (cached) return cached;
    cached = await loadConfig(bb.storage.kv);
    return cached;
  }

  bb.rpc.register(composerModesRpcContract, {
    async getModes() {
      const cfg = await getConfig();
      return { modes: cfg.modes, activeModeId: cfg.activeModeId };
    },
    async saveMode(input: unknown) {
      const parsed = modeInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid mode");
      const cfg = await getConfig();
      const isBuiltinId = defaultModes.some((m: ComposerMode) => m.id === parsed.data.id);
      if (isBuiltinId) {
        const idx = cfg.modes.findIndex((m: ComposerMode) => m.id === parsed.data.id);
        if (idx === -1) throw new Error("builtin not found");
        const updated: ComposerMode = { ...parsed.data, isBuiltin: true } as ComposerMode;
        cfg.modes[idx] = updated;
      } else {
        const idx = cfg.modes.findIndex((m: ComposerMode) => m.id === parsed.data.id);
        const mode: ComposerMode = { ...parsed.data, isBuiltin: false } as ComposerMode;
        if (idx >= 0) cfg.modes[idx] = mode;
        else cfg.modes.push(mode);
      }
      await saveConfig(bb.storage.kv, cfg);
      cached = cfg;
      bb.realtime.publish(REALTIME_CHANNEL, { id: parsed.data.id });
      return { mode: cfg.modes.find((m) => m.id === parsed.data.id)! };
    },
    async deleteMode(input: { id: string }) {
      const cfg = await getConfig();
      const idx = cfg.modes.findIndex((m: ComposerMode) => m.id === input.id);
      if (idx === -1) throw new Error(`mode "${input.id}" not found`);
      if (cfg.modes.length <= 1) throw new Error("cannot delete the only remaining persona");
      cfg.modes.splice(idx, 1);
      if (cfg.activeModeId === input.id) cfg.activeModeId = cfg.modes[0]?.id ?? "agent";
      await saveConfig(bb.storage.kv, cfg);
      cached = cfg;
      bb.realtime.publish(REALTIME_CHANNEL, { id: input.id });
      return { ok: true };
    },
    async toggleMode(input: { id: string; isEnabled: boolean }) {
      const cfg = await getConfig();
      const mode = cfg.modes.find((m: ComposerMode) => m.id === input.id);
      if (!mode) throw new Error(`mode "${input.id}" not found`);
      mode.isEnabled = input.isEnabled;
      await saveConfig(bb.storage.kv, cfg);
      cached = cfg;
      bb.realtime.publish(REALTIME_CHANNEL, { id: input.id });
      return { mode };
    },
    async setActiveMode(input: { id: string; threadId?: string }) {
      const cfg = await getConfig();
      if (!cfg.modes.some((m: ComposerMode) => m.id === input.id)) throw new Error(`mode "${input.id}" not found`);
      cfg.activeModeId = input.id;
      await saveConfig(bb.storage.kv, cfg);
      cached = cfg;
      bb.realtime.publish(REALTIME_CHANNEL, { id: input.id });
      const mode = cfg.modes.find((m) => m.id === input.id);
      if (input.threadId && mode?.preferredModel?.model) {
        try {
          const modelString =
            mode.preferredModel.routeProviderId && !mode.preferredModel.model.includes("/")
              ? `${mode.preferredModel.routeProviderId}/${mode.preferredModel.model}`
              : mode.preferredModel.model;
          await bb.sdk.threads.update({ threadId: input.threadId, model: modelString });
          await bb.realtime.publish("environment-changed", { id: input.threadId });
        } catch {}
      }
      return { activeModeId: input.id };
    },
  });

  bb.agents.registerTool({
    name: "save_composer_mode",
    description:
      "Create or update a composer mode or persona in BB. Use this whenever the user asks to create or save a new persona, role, or mode.",
    parameters: z.object({
      id: z.string().describe("Lowercase slug, e.g. 'tailwind-designer'"),
      name: z.string().describe("Display name, e.g. 'Tailwind Designer'"),
      icon: z.string().describe("Emoji or icon, e.g. '🎨'"),
      color: z.enum(["slate", "emerald", "amber", "violet", "sky", "rose", "orange"]),
      description: z.string().describe("What this persona specializes in"),
      promptPrefix: z.string().describe("The system instructions injected for this persona"),
      permissionMode: z.enum(["full", "readOnly"]).optional().default("full"),
      skills: z.array(z.string()).optional().default([]),
    }),
    async execute(params: { id: string; name: string; icon: string; color: ComposerMode["color"]; description: string; promptPrefix: string; permissionMode?: "full" | "readOnly"; skills?: string[] }) {
      const cfg = await getConfig();
      const mode: ComposerMode = {
        id: params.id,
        name: params.name,
        icon: params.icon,
        color: params.color,
        description: params.description,
        promptPrefix: params.promptPrefix,
        permissionMode: params.permissionMode ?? "full",
        skills: params.skills ?? [],
        preferredModel: (params as any).preferredModel ?? null,
        isBuiltin: false,
        isEnabled: true,
      };
      const parsed = composerModeSchema.safeParse(mode);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: parsed.error.issues[0]?.message ?? "invalid mode" }],
          isError: true,
        };
      }
      const idx = cfg.modes.findIndex((m) => m.id === mode.id);
      if (idx >= 0) cfg.modes[idx] = parsed.data;
      else cfg.modes.push(parsed.data);
      await saveConfig(bb.storage.kv, cfg);
      cached = cfg;
      bb.realtime.publish(REALTIME_CHANNEL, { id: mode.id });
      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully created persona "${mode.name}" (${mode.id}). It is now available in the composer mode selector.`,
          },
        ],
      };
    },
  });

  bb.agents.contributeInstructions(() => {
    if (!cached) return null;
    const active = cached.modes.find((m: ComposerMode) => m.id === cached!.activeModeId);
    if (!active || !active.isEnabled || !active.promptPrefix) return null;
    return active.promptPrefix;
  });
  void getConfig().then((c) => {
    cached = c;
  });

  bb.cli.register({
    name: "modes",
    summary: "Manage composer modes and personas",
    commands: [
      { name: "list", summary: "List available modes", usage: "bb modes list [--json]" },
      { name: "get", summary: "Show mode details", usage: "bb modes get <id> [--json]" },
      { name: "delete", summary: "Delete a custom mode", usage: "bb modes delete <id>" },
    ],
    async run(argv: string[]) {
      const json = argv.includes("--json");
      const positional = argv.filter((v: string) => v !== "--json");
      const [cmd, ...rest] = positional;
      const cfg = await getConfig();
      if (!cmd || cmd === "list") {
        if (json) return { exitCode: 0, stdout: JSON.stringify({ modes: cfg.modes, activeModeId: cfg.activeModeId }, null, 2) };
        const lines = cfg.modes.map(
          (m: ComposerMode) => `${m.isEnabled ? "●" : "○"} ${m.icon} ${m.id}: ${m.name} [${m.color}]${m.permissionMode === "readOnly" ? " [readOnly]" : ""} (${m.description})`,
        );
        return { exitCode: 0, stdout: `Active: ${cfg.activeModeId}\n${lines.join("\n")}` };
      }
      if (cmd === "get") {
        const id = rest[0];
        if (!id) return { exitCode: 1, stderr: "Usage: bb modes get <id> [--json]" };
        const mode = cfg.modes.find((m: ComposerMode) => m.id === id);
        if (!mode) return { exitCode: 1, stderr: `mode "${id}" not found` };
        if (json) return { exitCode: 0, stdout: JSON.stringify(mode, null, 2) };
        return { exitCode: 0, stdout: `${mode.icon} ${mode.name} (${mode.id})\n${mode.description}\nPermission: ${mode.permissionMode}\nPrompt:\n${mode.promptPrefix}` };
      }
      if (cmd === "delete") {
        const id = rest[0];
        if (!id) return { exitCode: 1, stderr: "Usage: bb modes delete <id>" };
        if (defaultModes.some((m: ComposerMode) => m.id === id)) return { exitCode: 1, stderr: "cannot delete built-in mode" };
        const idx = cfg.modes.findIndex((m: ComposerMode) => m.id === id);
        if (idx === -1) return { exitCode: 1, stderr: `mode "${id}" not found` };
        cfg.modes.splice(idx, 1);
        if (cfg.activeModeId === id) cfg.activeModeId = "agent";
        await saveConfig(bb.storage.kv, cfg);
        cached = cfg;
        bb.realtime.publish(REALTIME_CHANNEL, { id });
        return { exitCode: 0, stdout: `Deleted mode "${id}"` };
      }
      return { exitCode: 1, stderr: "Usage: bb modes list|get <id>|delete <id> [--json]" };
    },
  });
}
