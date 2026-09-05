export type HiddenMap = Record<string, string[]>;

export interface LensConfig {
  hidden: HiddenMap;
  menuWidthRem: number;
  showProviders: boolean;
}

export const DEFAULT_MENU_WIDTH_REM = 20;
export const MIN_MENU_WIDTH_REM = 16;
export const MAX_MENU_WIDTH_REM = 32;

export function defaultConfig(): LensConfig {
  return { hidden: {}, menuWidthRem: DEFAULT_MENU_WIDTH_REM, showProviders: true };
}

export function keyOf(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function isVisible(config: LensConfig, providerId: string, modelId: string): boolean {
  for (const [p, list] of Object.entries(config.hidden)) {
    if (!Array.isArray(list)) continue;
    if (list.includes(modelId)) return false;
    const prefix = `${p}/`;
    if (modelId.startsWith(prefix) && list.includes(modelId.slice(prefix.length))) return false;
  }
  return true;
}

export function hiddenCount(config: LensConfig): number {
  return Object.values(config.hidden).reduce((n, ids) => n + ids.length, 0);
}

export function migrateLegacyHidden(hidden: HiddenMap): HiddenMap {
  const next: HiddenMap = { ...hidden };
  if (Array.isArray(next.pi)) {
    for (const ref of next.pi) {
      const slash = ref.indexOf("/");
      if (slash > 0) {
        const p = ref.slice(0, slash);
        next[p] = [...new Set([...(next[p] ?? []), ref])].sort();
      }
    }
    delete next.pi;
  }
  return next;
}

export function setHidden(config: LensConfig, providerId: string, modelId: string, hidden: boolean): LensConfig {
  const next: HiddenMap = migrateLegacyHidden(config.hidden);
  if (hidden) {
    const ids = new Set(next[providerId] ?? []);
    ids.add(modelId);
    next[providerId] = [...ids].sort();
  } else {
    for (const [p, list] of Object.entries(next)) {
      const remaining = list.filter((id) => id !== modelId && id !== modelId.replace(`${p}/`, ""));
      if (remaining.length === 0) delete next[p];
      else next[p] = remaining;
    }
  }
  return { ...config, hidden: next };
}

export function clearHidden(config: LensConfig): LensConfig {
  return { ...config, hidden: {} };
}

export function clampWidth(rem: number): number {
  if (!Number.isFinite(rem)) return DEFAULT_MENU_WIDTH_REM;
  return Math.min(MAX_MENU_WIDTH_REM, Math.max(MIN_MENU_WIDTH_REM, rem));
}

export function buildProviderIndex(catalog: Array<{ models: Array<{ displayName: string; provider: string }> }>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const group of catalog) {
    for (const m of group.models) {
      if (!m.displayName || !m.provider) continue;
      let byLabel = counts.get(m.displayName);
      if (!byLabel) { byLabel = new Map(); counts.set(m.displayName, byLabel); }
      byLabel.set(m.provider, (byLabel.get(m.provider) ?? 0) + 1);
    }
  }
  const index = new Map<string, string>();
  for (const [label, byLabel] of counts) {
    if (byLabel.size === 1) index.set(label, [...byLabel.keys()][0]);
  }
  return index;
}

export function formatWithProvider(label: string, provider: string): string {
  const trimmed = label.trim();
  if (!provider || trimmed.toLowerCase().startsWith(provider.toLowerCase() + " · ")) return label;
  return `${provider} · ${trimmed}`;
}

export function collapseLabel(count: number, expanded: boolean): string {
  return expanded ? "Hide hidden models" : `${count} hidden — show`;
}
