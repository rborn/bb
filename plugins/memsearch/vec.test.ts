import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cosine, ensureVecIndex, vecHash, vecSearch } from "./vec";

// Deterministic toy embeddings (unit vectors): related share direction, unrelated don't.
const norm = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
};
const toy: Record<string, number[]> = {
  car: norm([1, 0.2, 0]),
  automobile: norm([0.95, 0.25, 0]),
  mountain: norm([0.1, 1, 0.1]),
  physics: norm([0, 0.1, 1]),
  other: norm([0.2, 0.2, 0.2]),
};
const inject = async (texts: string[]): Promise<number[][]> =>
  texts.map((t) => {
    const k = Object.keys(toy).find((k) => t.toLowerCase().includes(k)) ?? "other";
    return toy[k];
  });

describe("vec", () => {
  it("cosine separates related from unrelated", () => {
    expect(cosine(toy.car, toy.automobile)).toBeGreaterThan(0.9);
    expect(cosine(toy.car, toy.physics)).toBeLessThan(0.3);
  });

  it("indexes and finds paraphrases FTS would miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vec-"));
    const bullets = ["- owns a red car", "- likes mountain drives"];
    expect(await ensureVecIndex(dir, bullets, inject)).toBe(2);
    // "automobile" shares no FTS term with "car" but is semantically close
    const hits = await vecSearch(dir, "my automobile", bullets, 5, inject);
    expect(hits).toContain("- owns a red car");
    const miss = await vecSearch(dir, "quantum physics", bullets, 5, inject);
    expect(miss).toEqual([]);
  });

  it("prunes stale entries and degrades without an index", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vec-"));
    await ensureVecIndex(dir, ["- fizzy automata"], inject);
    expect(await ensureVecIndex(dir, ["- quantum physics"], inject)).toBe(1);
    // "my automobile"→automobile vs "- quantum physics"→physics: cosine ~0 → miss
    expect(await vecSearch(dir, "my automobile", ["- quantum physics"], 5, inject)).toEqual([]);
    expect(await vecSearch(mkdtempSync(join(tmpdir(), "vec-empty-")), "car", [], 5, inject)).toEqual([]);
  });

  it("vecHash is stable", () => {
    expect(vecHash("x")).toBe(vecHash("x"));
    expect(vecHash("x")).not.toBe(vecHash("y"));
  });
});
