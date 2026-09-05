import {
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  clampWidth,
  clearHidden,
  defaultConfig,
  setHidden,
  type LensConfig,
} from "./visibility.js";

const CONFIG_KEY = "model-lens:config:v1";

const lensConfigSchema = z
  .object({
    hidden: z.record(z.string(), z.array(z.string())).default({}),
    menuWidthRem: z.number().default(20),
    showProviders: z.boolean().default(true),
  })
  .strict();

export const modelLensRpcContract = defineRpcContract({
  getConfig: {
    input: z.null(),
    output: lensConfigSchema,
  },
  setModelHidden: {
    input: z.object({ providerId: z.string().min(1), modelId: z.string().min(1), hidden: z.boolean() }).strict(),
    output: lensConfigSchema,
  },
  clearAllHidden: {
    input: z.null(),
    output: lensConfigSchema,
  },
  setMenuWidth: {
    input: z.object({ rem: z.number() }).strict(),
    output: lensConfigSchema,
  },
  setShowProviders: {
    input: z.object({ show: z.boolean() }).strict(),
    output: lensConfigSchema,
  },
  listCatalog: {
    input: z.null(),
    output: z.object({
      providers: z.array(z.object({
        id: z.string(),
        displayName: z.string(),
        models: z.array(z.object({ id: z.string(), displayName: z.string(), provider: z.string().default("") })),
      }).strict()),
    }).strict(),
  },
});

export interface CatalogProvider {
  id: string;
  displayName: string;
  models: Array<{ id: string; displayName: string; provider: string }>;
}

function formatProviderTitle(id: string): string {
  const map: Record<string, string> = {
    anthropic: "Anthropic",
    cursor: "Cursor",
    deepinfra: "DeepInfra",
    deepseek: "DeepSeek",
    google: "Google",
    opencode: "OpenCode",
    "opencode-go": "OpenCode Go",
    pi: "Pi",
  };
  return map[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);
}

export function mapCatalogResponse(res: any): CatalogProvider[] {
  const groups = (res?.providers ?? res?.groups ?? []) as any[];
  const all = ((res?.models ?? []) as any[]).map((m: any) => ({
    id: String(m?.id ?? m?.model ?? ""),
    displayName: String(m?.displayName ?? m?.name ?? m?.id ?? ""),
    provider: String(m?.routeProviderId ?? m?.provider ?? ""),
  })).filter((m: any) => m.id);
  return groups.map((g: any) => ({
    id: String(g?.id ?? g?.providerId ?? ""),
    displayName: String(g?.displayName ?? g?.name ?? g?.id ?? ""),
    models: all,
  })).filter((p: any) => p.id);
}

async function readConfig(bb: BbPluginApi): Promise<LensConfig> {
  const raw = await bb.storage.kv.get<LensConfig>(CONFIG_KEY);
  if (!raw) return defaultConfig();
  return {
    hidden: raw.hidden ?? {},
    menuWidthRem: clampWidth(raw.menuWidthRem ?? 20),
    showProviders: raw.showProviders ?? true,
  };
}

async function writeConfig(bb: BbPluginApi, config: LensConfig): Promise<LensConfig> {
  const next: LensConfig = { hidden: config.hidden, menuWidthRem: clampWidth(config.menuWidthRem), showProviders: config.showProviders ?? true };
  await bb.storage.kv.set(CONFIG_KEY, next);
  bb.realtime.publish("model-lens:changed", next);
  return next;
}

export default function plugin(bb: BbPluginApi): void {
  const log = (...a: unknown[]) => (bb.log as any)?.info?.(`[model-lens] ${a.map(String).join(" ")}`);

  bb.rpc.register(modelLensRpcContract, {
    async getConfig() {
      return readConfig(bb);
    },
    async setModelHidden(input) {
      const config = await readConfig(bb);
      return writeConfig(bb, setHidden(config, input.providerId, input.modelId, input.hidden));
    },
    async clearAllHidden() {
      return writeConfig(bb, clearHidden(await readConfig(bb)));
    },
    async setMenuWidth(input) {
      const config = await readConfig(bb);
      return writeConfig(bb, { ...config, menuWidthRem: clampWidth(input.rem) });
    },
    async setShowProviders(input) {
      const config = await readConfig(bb);
      return writeConfig(bb, { ...config, showProviders: input.show });
    },
    async listCatalog() {
      try {
        const providersRes = await bb.sdk.providers.list();
        const availableProviders = providersRes.filter((p) => p.available);
        const result: CatalogProvider[] = [];
        for (const p of availableProviders) {
          try {
            const execOptions = await bb.sdk.providers.models({ providerId: p.id, all: "true" });
            const byProvider = new Map<string, Array<{ id: string; displayName: string; provider: string }>>();
            for (const m of (execOptions.models ?? []) as any[]) {
              const routeId = String(m.routeProviderId || p.id);
              if (!byProvider.has(routeId)) byProvider.set(routeId, []);
              byProvider.get(routeId)!.push({
                id: m.model,
                displayName: m.displayName || m.model,
                provider: routeId,
              });
            }
            for (const [routeId, models] of byProvider) {
              result.push({
                id: routeId,
                displayName: formatProviderTitle(routeId),
                models,
              });
            }
          } catch (e) {
            log(`failed to list models for provider ${p.id}`, e);
          }
        }
        return { providers: result.sort((a, b) => a.displayName.localeCompare(b.displayName)) };
      } catch (e) {
        log("listCatalog failed", String((e as Error)?.message ?? e).slice(0, 120));
        return { providers: [] };
      }
    },
  });

  bb.cli.register({
    name: "model-lens",
    summary: "Show, hide, and size the model picker",
    commands: [
      { name: "list", summary: "List hidden models", usage: "bb model-lens list [--json]" },
      { name: "hide", summary: "Hide a model", usage: "bb model-lens hide <provider/model> [--json]" },
      { name: "show", summary: "Show a model again", usage: "bb model-lens show <provider/model> [--json]" },
      { name: "clear", summary: "Show all models", usage: "bb model-lens clear [--json]" },
      { name: "width", summary: "Set picker width in rem", usage: "bb model-lens width <rem> [--json]" },
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      const wantsJson = rest.includes("--json");
      const args = rest.filter((a) => !a.startsWith("--"));
      const out = (obj: unknown, text: string) =>
        wantsJson
          ? { exitCode: 0, stdout: JSON.stringify(obj), stderr: "" }
          : { exitCode: 0, stdout: text, stderr: "" };
      const splitRef = (ref: string | undefined) => {
        if (!ref) return null;
        const i = ref.indexOf("/");
        if (i <= 0) return null;
        return { providerId: ref.slice(0, i), modelId: ref.slice(i + 1) };
      };
      if (command === "list") {
        const config = await readConfig(bb);
        const rows = Object.entries(config.hidden).flatMap(([p, ids]) => ids.map((id) => `${p}/${id}`));
        return out({ hidden: rows, menuWidthRem: config.menuWidthRem }, rows.length > 0 ? rows.join("\n") : "nothing hidden");
      }
      if (command === "hide" || command === "show") {
        const ref = splitRef(args[0]);
        if (!ref) return { exitCode: 1, stdout: "", stderr: "usage: bb model-lens hide|show <provider/model>" };
        const config = await readConfig(bb);
        const next = await writeConfig(bb, setHidden(config, ref.providerId, ref.modelId, command === "hide"));
        return out({ hidden: next.hidden }, `${command === "hide" ? "hidden" : "shown"}: ${args[0]}`);
      }
      if (command === "clear") {
        await writeConfig(bb, clearHidden(await readConfig(bb)));
        return out({ hidden: {} }, "all models shown");
      }
      if (command === "width") {
        const rem = Number(args[0]);
        if (!Number.isFinite(rem)) return { exitCode: 1, stdout: "", stderr: "usage: bb model-lens width <rem>" };
        const config = await readConfig(bb);
        const next = await writeConfig(bb, { ...config, menuWidthRem: clampWidth(rem) });
        return out({ menuWidthRem: next.menuWidthRem }, `picker width: ${next.menuWidthRem}rem`);
      }
      return { exitCode: 1, stdout: "", stderr: "usage: bb model-lens <list|hide|show|clear|width>" };
    },
  });
}
