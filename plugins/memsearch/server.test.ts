import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendBullets,
  buildExtractorPrompt,
  dayFile,
  extractCandidates,
  parseExtractorOutput,
  recentBullets,
  searchBullets,
  textsFromTimeline,
  userPreviewsFromOutline,
  userTextsFromTimeline,
} from "./server";

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "memsearch-"));
}

describe("extractCandidates", () => {
  it("keeps durable statements, drops chatter", () => {
    const out = extractCandidates(
      "I have a red car and a black motorbike. please remember that. ok thanks",
      "Done, saved it.",
    );
    expect(out.some((s) => s.includes("red car"))).toBe(true);
    expect(out.some((s) => s.includes("ok thanks"))).toBe(false);
  });

  it("ignores empty input", () => {
    expect(extractCandidates(undefined, undefined)).toEqual([]);
  });
});

describe("userTextsFromTimeline", () => {
  it("reads user turns, falls back to outline previews", () => {
    expect(userTextsFromTimeline({ turns: [{ messages: [{ role: "user", text: "I have a red car" }] }] }))
      .toEqual(["I have a red car"]);
    expect(userTextsFromTimeline({ items: [{ role: "user", preview: "we use pnpm" }] }))
      .toEqual(["we use pnpm"]);
    expect(userTextsFromTimeline({})).toEqual([]);
  });
});

describe("extractor prompt + parse", () => {
  it("builds a capped prompt and parses bullets", () => {
    const prompt = buildExtractorPrompt({
      intent: "setup project",
      candidates: ["we use pnpm", "chatter"],
      recent: ["- old fact (thr_1)"],
    });
    expect(prompt).toContain("we use pnpm");
    expect(prompt).toContain("Already saved");
    expect(parseExtractorOutput("- we use pnpm (store corrupts)\n- second\nNONE")).toEqual([
      "we use pnpm (store corrupts)",
      "second",
    ]);
    expect(parseExtractorOutput("NONE")).toEqual([]);
    expect(parseExtractorOutput(undefined)).toEqual([]);
  });
  it("textsFromTimeline reads assistant role", () => {
    expect(textsFromTimeline({ turns: [{ messages: [{ role: "assistant", text: "done" }] }] }, "assistant", 1))
      .toEqual(["done"]);
  });
  it("userPreviewsFromOutline reads user previews", () => {
    expect(userPreviewsFromOutline({ items: [{ role: "user", preview: "my editor is zed" }] }, 3))
      .toEqual(["my editor is zed"]);
    expect(userPreviewsFromOutline({})).toEqual([]);
  });
});

describe("daily markdown round-trip", () => {
  it("appends and recalls bullets", () => {
    const root = freshRoot();
    expect(appendBullets(root, "thr_x", ["prefers pnpm high reasoning"])).toBe(1);
    expect(recentBullets(root)).toHaveLength(1);
    expect(searchBullets(root, "prefers", 5)).toHaveLength(1);
    expect(searchBullets(root, "elephant", 5)).toHaveLength(0);
  });

  it("writes one file per day", () => {
    const root = freshRoot();
    appendBullets(root, "thr_x", ["a"]);
    appendBullets(root, "thr_y", ["b"]);
    const files = readdirSync(join(root, ".bb", "memsearch"));
    expect(files).toHaveLength(1);
    expect(readFileSync(dayFile(root), "utf8")).toContain("(thr_x)");
  });
});
