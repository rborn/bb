import { describe, expect, it } from "vitest";
import {
  buildProviderIndex,
  clearHidden,
  clampWidth,
  collapseLabel,
  defaultConfig,
  formatWithProvider,
  hiddenCount,
  isVisible,
  keyOf,
  migrateLegacyHidden,
  setHidden,
  MAX_MENU_WIDTH_REM,
  MIN_MENU_WIDTH_REM,
} from "./visibility.js";

describe("visibility", () => {
  it("defaults to everything visible", () => {
    const c = defaultConfig();
    expect(isVisible(c, "pi", "x")).toBe(true);
    expect(hiddenCount(c)).toBe(0);
  });
  it("hides and restores per provider/model", () => {
    let c = setHidden(defaultConfig(), "pi", "old-model", true);
    expect(isVisible(c, "pi", "old-model")).toBe(false);
    expect(isVisible(c, "pi", "other")).toBe(true);
    expect(hiddenCount(c)).toBe(1);
    expect(keyOf("pi", "old-model")).toBe("pi/old-model");
    c = setHidden(c, "pi", "old-model", false);
    expect(isVisible(c, "pi", "old-model")).toBe(true);
    expect(clearHidden(setHidden(c, "x", "y", true))).toEqual(defaultConfig());
  });
  it("migrates legacy pi provider keys", () => {
    const legacy = { pi: ["cursor/auto", "deepinfra/phi-4"] };
    const migrated = migrateLegacyHidden(legacy);
    expect(migrated.pi).toBeUndefined();
    expect(migrated.cursor).toEqual(["cursor/auto"]);
    expect(migrated.deepinfra).toEqual(["deepinfra/phi-4"]);
  });
  it("clamps width", () => {
    expect(clampWidth(24)).toBe(24);
    expect(clampWidth(1)).toBe(MIN_MENU_WIDTH_REM);
    expect(clampWidth(99)).toBe(MAX_MENU_WIDTH_REM);
    expect(clampWidth(Number.NaN)).toBe(20);
  });
  it("labels the collapse row", () => {
    expect(collapseLabel(3, false)).toContain("3 hidden");
    expect(collapseLabel(3, true)).toContain("Hide");
  });
  it("prefixes provider once, skips ambiguous labels", () => {
    expect(formatWithProvider("phi-4", "deepinfra")).toBe("deepinfra · phi-4");
    expect(formatWithProvider("deepinfra · phi-4", "deepinfra")).toBe("deepinfra · phi-4");
    expect(formatWithProvider("x", "")).toBe("x");
    const index = buildProviderIndex([
      { models: [{ displayName: "phi-4", provider: "deepinfra" }] },
      { models: [{ displayName: "Claude", provider: "a" }, { displayName: "Claude", provider: "b" }] },
    ]);
    expect(index.get("phi-4")).toBe("deepinfra");
    expect(index.has("Claude")).toBe(false);
  });
});
