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
  const list = config.hidden[providerId];
  if (!list) return true;
  if (list.includes(modelId)) return false;
  const prefix = `${providerId}/`;
  if (modelId.startsWith(prefix) && list.includes(modelId.slice(prefix.length))) return false;
  return true;
}

export function hiddenCount(config: LensConfig): number {
  return Object.values(config.hidden).reduce((n, ids) => n + ids.length, 0);
}

export function setHidden(config: LensConfig, providerId: string, modelId: string, hidden: boolean): LensConfig {
  const ids = new Set(config.hidden[providerId] ?? []);
  if (hidden) ids.add(modelId);
  else ids.delete(modelId);
  const next: HiddenMap = { ...config.hidden };
  if (ids.size === 0) delete next[providerId];
  else next[providerId] = [...ids].sort();
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
