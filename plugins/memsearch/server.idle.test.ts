import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import memsearchPlugin from "./server";

function memFiles(dir: string): string[] {
  try {
    return readdirSync(join(dir, ".bb", "memsearch")).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

async function setup(opts: { extractorOutput: string; spawnResult?: any }) {
  const projectDir = mkdtempSync(join(tmpdir(), "memsearch-idle-"));
  const host = createFakePluginHost({ pluginId: "memsearch" });
  await memsearchPlugin(host.bb);
  const sdk = host.harness.sdk;
  sdk.stub("environments.get", async () => ({ path: projectDir }));
  sdk.stub("projects.get", async () => ({ project: { path: projectDir } }));
  sdk.stub("threads.conversationOutline", async () => ({
    items: [{ id: "1", role: "user", preview: "I like japan a lot" }],
  }));
  sdk.stub("threads.output", async () => ({ output: opts.extractorOutput }));
  sdk.stub("threads.spawn", async () => opts.spawnResult ?? { id: "thr_ext1" });
  sdk.stub("threads.wait", async () => ({}));
  sdk.stub("threads.archive", async () => ({}));
  return { host, projectDir };
}

describe("thread.idle pipeline", () => {
  it("saves extractor bullets to the project day file (ThreadResponse {id} shape)", async () => {
    const { host, projectDir } = await setup({
      extractorOutput: "- Likes Japan a lot (user preference)",
    });
    await host.harness.emitThreadEvent("thread.idle", {
      thread: { id: "thr_main", projectId: "proj_x", providerId: "pi", environmentId: "env_1" } as any,
      lastAssistantText: "Japan is awesome!",
    });
    // let the fire-and-forget handler settle
    await vi.waitFor(() => expect(memFiles(projectDir).length).toBe(1), { timeout: 5000 });
    const files = memFiles(projectDir);
    const body = readFileSync(join(projectDir, ".bb", "memsearch", files[0]), "utf8");
    expect(body).toContain("Likes Japan");
    expect(body).toContain("thr_main");
    // spawn was hidden + reused env
    const spawns = host.harness.sdk.callsTo("threads.spawn");
    expect(spawns.length).toBe(1);
    expect(spawns[0][0]).toMatchObject({
      visibility: "hidden",
      environment: { type: "reuse", environmentId: "env_1" },
    });
  });

  it("saves nothing when the extractor judges NONE", async () => {
    const { host, projectDir } = await setup({ extractorOutput: "NONE" });
    await host.harness.emitThreadEvent("thread.idle", {
      thread: { id: "thr_main", projectId: "proj_x", providerId: "pi", environmentId: "env_1" } as any,
      lastAssistantText: "ok",
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(memFiles(projectDir).length).toBe(0);
  });

  it("backfill extracts an older thread on demand", async () => {
    const { host, projectDir } = await setup({
      extractorOutput: "- Owns a blue car (user fact)",
    });
    const res = await host.harness.runCli(["backfill", "thr_old", "--json"], {
      projectId: "proj_backfill", // distinct: pathCache is module-level across tests
      threadId: "thr_now",
    });
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).saved).toBe(1);
    await vi.waitFor(() => expect(memFiles(projectDir).length).toBe(1), { timeout: 5000 });
    const body = readFileSync(join(projectDir, ".bb", "memsearch", memFiles(projectDir)[0]), "utf8");
    expect(body).toContain("blue car");
    expect(body).toContain("thr_old"); // source attribution, not the invoking thread
  }, 20000); // backfill loads the real vec model on first index

  it("strips a deleted thread's bullets, keeps others", async () => {
    const { host, projectDir } = await setup({ extractorOutput: "- fact" });
    const { appendBullets, forgetThreadBullets, markThreadBulletsArchived } = await import("./server");
    appendBullets(projectDir, "thr_gone", ["Owns a blue car"]);
    appendBullets(projectDir, "thr_kept", ["Likes Japan"]);
    expect(forgetThreadBullets(projectDir, "thr_gone")).toBe(1);
    const body = readFileSync(join(projectDir, ".bb", "memsearch", memFiles(projectDir)[0]), "utf8");
    expect(body).not.toContain("blue car");
    expect(body).toContain("Likes Japan");
    expect(markThreadBulletsArchived(projectDir, "thr_kept")).toBe(1);
    const marked = readFileSync(join(projectDir, ".bb", "memsearch", memFiles(projectDir)[0]), "utf8");
    expect(marked).toContain("(thr_kept, archived)");
    expect(forgetThreadBullets(projectDir, "thr_kept")).toBe(1); // archived form also stripped
  });

  it("emits forget/archive via thread events", async () => {
    const { host, projectDir } = await setup({ extractorOutput: "- fact" });
    const { appendBullets } = await import("./server");
    appendBullets(projectDir, "thr_e", ["Owns a blue car"]);
    await host.harness.emitThreadEvent("thread.archived", {
      thread: { id: "thr_e", projectId: "proj Ev", environmentId: "env_1" } as any,
    });
    await host.harness.emitThreadEvent("thread.deleted", {
      thread: { id: "thr_e", projectId: "proj Ev", environmentId: "env_1" } as any,
    });
    await vi.waitFor(() => {
      const files = memFiles(projectDir);
      const body = files.length > 0 ? readFileSync(join(projectDir, ".bb", "memsearch", files[0]), "utf8") : "";
      expect(body).not.toContain("blue car");
    }, { timeout: 5000 });
  });

  it("skips personal projects", async () => {
    const { host, projectDir } = await setup({ extractorOutput: "- fact" });
    await host.harness.emitThreadEvent("thread.idle", {
      thread: { id: "thr_p", projectId: "proj_personal", providerId: "pi" } as any,
      lastAssistantText: "hi",
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(memFiles(projectDir).length).toBe(0);
    expect(host.harness.sdk.callsTo("threads.spawn").length).toBe(0);
  });
});
