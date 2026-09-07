import { useCallback, useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginRpcResult,
} from "@get-bb/plugin-sdk/app";
import type { modelLensRpcContract } from "./server.js";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Slider } from "@bb/shared-ui/slider";
import { Switch } from "@bb/shared-ui/switch";
import { Separator } from "@bb/shared-ui/separator";
import {
  isVisible,
  MAX_MENU_WIDTH_REM,
  MIN_MENU_WIDTH_REM,
  type HiddenMap,
} from "./visibility.js";

type LensConfig = PluginRpcResult<(typeof modelLensRpcContract)["getConfig"]>;
type Catalog = PluginRpcResult<(typeof modelLensRpcContract)["listCatalog"]>;

const STORAGE_WIDTH_KEY = "bb-model-picker-width";
const STORAGE_HIDDEN_KEY = "bb-model-lens-hidden";

let activeHiddenMap: HiddenMap | null = null;
try {
  const storedHidden = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_HIDDEN_KEY) : null;
  if (storedHidden) {
    activeHiddenMap = JSON.parse(storedHidden) as HiddenMap;
  }
} catch {}

function updateStoredHidden(map: HiddenMap): void {
  activeHiddenMap = map;
  try {
    localStorage.setItem(STORAGE_HIDDEN_KEY, JSON.stringify(map));
  } catch {}
}

function applyWidth(rem: number): void {
  try {
    document.documentElement.style.setProperty("--model-picker-menu-width", `${rem}rem`);
    localStorage.setItem(STORAGE_WIDTH_KEY, String(rem));
  } catch {}
}

try {
  const initial = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_WIDTH_KEY) : null;
  if (initial) {
    const num = Number(initial);
    if (Number.isFinite(num) && num >= MIN_MENU_WIDTH_REM && num <= MAX_MENU_WIDTH_REM) {
      document.documentElement.style.setProperty("--model-picker-menu-width", `${num}rem`);
    }
  }
} catch {}

function LensSettings() {
  const rpc = useRpc<typeof modelLensRpcContract>();
  const [config, setConfig] = useState<LensConfig | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sliderWidth, setSliderWidth] = useState<number>(() => {
    try {
      const s = localStorage.getItem(STORAGE_WIDTH_KEY);
      if (s) {
        const n = Number(s);
        if (Number.isFinite(n) && n >= MIN_MENU_WIDTH_REM && n <= MAX_MENU_WIDTH_REM) return n;
      }
    } catch {}
    return 20;
  });

  const refresh = useCallback(async () => {
    try {
      const [c, cat] = await Promise.all([rpc.call("getConfig", null), rpc.call("listCatalog", null)]);
      setConfig(c);
      setCatalog(cat);
      if (c.hidden) {
        updateStoredHidden(c.hidden);
      }
      if (typeof c.menuWidthRem === "number") {
        setSliderWidth(c.menuWidthRem);
        applyWidth(c.menuWidthRem);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (providerId: string, modelId: string, visible: boolean) => {
      try {
        const next = await rpc.call("setModelHidden", { providerId, modelId, hidden: !visible });
        setConfig(next);
        if (next.hidden) {
          updateStoredHidden(next.hidden);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [rpc],
  );

  const toggleAllForProvider = useCallback(
    async (providerId: string, models: Array<{ id: string }>, allVisible: boolean) => {
      try {
        let latestConfig: LensConfig | null = null;
        for (const m of models) {
          latestConfig = await rpc.call("setModelHidden", { providerId, modelId: m.id, hidden: allVisible });
        }
        if (latestConfig) {
          setConfig(latestConfig);
          if (latestConfig.hidden) {
            updateStoredHidden(latestConfig.hidden);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [rpc],
  );

  const setWidth = useCallback(
    async (rem: number) => {
      try {
        applyWidth(rem);
        const next = await rpc.call("setMenuWidth", { rem });
        setConfig(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [rpc],
  );

  const clear = useCallback(async () => {
    try {
      const next = await rpc.call("clearAllHidden", null);
      setConfig(next);
      if (next.hidden) {
        updateStoredHidden(next.hidden);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rpc]);

  const filteredCatalog = useMemo(() => {
    if (!catalog) return null;
    const q = search.trim().toLowerCase();
    if (!q) return catalog.providers;
    return catalog.providers
      .map((p) => {
        const matchesProvider = p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
        const models = matchesProvider
          ? p.models
          : p.models.filter((m) =>
              m.id.toLowerCase().includes(q) ||
              m.displayName.toLowerCase().includes(q) ||
              m.provider.toLowerCase().includes(q),
            );
        return { ...p, models };
      })
      .filter((p) => p.models.length > 0);
  }, [catalog, search]);

  if (error) return <div className="text-xs text-destructive-text">{error}</div>;
  if (!config) return <div className="text-xs text-muted-foreground">Loading lens…</div>;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Picker width: {sliderWidth}rem</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setSliderWidth(20);
              applyWidth(20);
              void setWidth(20);
            }}
          >
            Reset (20rem)
          </Button>
        </div>
        <Slider
          aria-label="Picker width"
          min={MIN_MENU_WIDTH_REM}
          max={MAX_MENU_WIDTH_REM}
          step={1}
          value={[sliderWidth]}
          onValueChange={([v]) => {
            if (typeof v === "number") {
              setSliderWidth(v);
              applyWidth(v);
            }
          }}
          onValueCommit={([v]) => {
            if (typeof v === "number") {
              void setWidth(v);
            }
          }}
        />
      </div>
      <Separator />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Filter models in the picker. Turn off to hide.</span>
        <Button variant="ghost" size="sm" onClick={() => void clear()}>
          Show all
        </Button>
      </div>
      <Input
        placeholder="Filter models or providers..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 text-xs"
      />
      {filteredCatalog && filteredCatalog.length > 0 ? (
        <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
          {filteredCatalog.map((p) => {
            const visibleCount = p.models.filter((m) => isVisible(config, p.id, m.id)).length;
            const anyVisible = visibleCount > 0;
            return (
              <div key={p.id} className="space-y-1 rounded-sm border border-border/40 p-2">
                <div className="flex items-center justify-between pb-1 border-b border-border/40">
                  <div className="text-xs font-semibold text-foreground">
                    {p.displayName} <span className="text-muted-foreground font-normal">({visibleCount}/{p.models.length})</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => void toggleAllForProvider(p.id, p.models, anyVisible)}
                  >
                    {anyVisible ? "Hide all" : "Show all"}
                  </Button>
                </div>
                <div className="space-y-0.5 pt-1">
                  {p.models.map((m) => {
                    const visible = isVisible(config, p.id, m.id);
                    return (
                      <label key={m.id} className="flex items-center justify-between gap-2 py-0.5 text-xs hover:bg-muted/40 rounded px-1 cursor-pointer">
                        <span className="min-w-0 flex-1 truncate" title={m.id}>{m.displayName || m.id}</span>
                        <Switch
                          aria-label={`Show ${m.displayName || m.id}`}
                          checked={visible}
                          onCheckedChange={(v) => void toggle(p.id, m.id, v === true)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {search ? "No matching models found." : "No models available."}
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "model-lens-interceptor",
    async mount(context) {
      const originalFetch = window.fetch;
      window.fetch = async function (input, init) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url;
        if (typeof url === "string" && url.includes("/api/v1/system/execution-options")) {
          const isAll = url.includes("all=true");
          if (!isAll) {
            const res = await originalFetch.call(window, input, init);
            if (!res.ok) return res;
            try {
              const clone = res.clone();
              const json = await clone.json();
              if (Array.isArray(json?.models) && activeHiddenMap) {
                const filtered = json.models.filter((m: { routeProviderId?: string; providerId?: string; id?: string; model?: string }) => {
                  const routeId = m.routeProviderId || m.providerId || "pi";
                  const modelId = m.id || m.model || "";
                  return isVisible({ hidden: activeHiddenMap! }, routeId, modelId);
                });
                const modified = { ...json, models: filtered.length > 0 ? filtered : json.models };
                return new Response(JSON.stringify(modified), {
                  status: res.status,
                  statusText: res.statusText,
                  headers: res.headers,
                });
              }
            } catch {
              return res;
            }
          }
        }
        return originalFetch.call(window, input, init);
      };

      try {
        const res = await originalFetch("/api/v1/plugins/model-lens/rpc/getConfig", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "null",
          signal: context.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { result?: { menuWidthRem?: number; hidden?: HiddenMap } };
          if (typeof data?.result?.menuWidthRem === "number") {
            applyWidth(data.result.menuWidthRem);
          }
          if (data?.result?.hidden) {
            updateStoredHidden(data.result.hidden);
          }
        }
      } catch {}

      return () => {
        window.fetch = originalFetch;
      };
    },
  });

  app.slots.settingsSection({
    id: "model-lens",
    title: "Model Lens",
    description: "Choose which models appear in the picker, and how wide it is.",
    component: LensSettings,
  });
});
