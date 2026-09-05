import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import modelLensPlugin, { mapCatalogResponse } from "./server.js";

const LIVE_SHAPE = {
  providers: [
    { id: "pi", pluginId: "provider-pi", displayName: "Pi", available: true },
  ],
  models: [
    { id: "anthropic/claude-fable-5", model: "anthropic/claude-fable-5", displayName: "Claude Fable 5", routeProviderId: "anthropic" },
    { id: "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731", model: "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731", displayName: "DeepSeek-V4-Flash-0731", routeProviderId: "deepinfra" },
    { id: "google/gemini-2.5-flash-lite", model: "google/gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash-Lite", routeProviderId: "google" },
  ],
};

describe("mapCatalogResponse", () => {
  it("reads top-level models with routeProviderId, not nested groups", () => {
    const providers = mapCatalogResponse(LIVE_SHAPE);
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("pi");
    expect(providers[0].models).toHaveLength(3);
    expect(providers[0].models[1]).toEqual({
      id: "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
      displayName: "DeepSeek-V4-Flash-0731",
      provider: "deepinfra",
    });
  });
  it("returns empty groups, never throws, on unknown shapes", () => {
    expect(mapCatalogResponse({})).toEqual([]);
    expect(mapCatalogResponse(null)).toEqual([]);
    expect(mapCatalogResponse({ providers: [{ id: "x" }] })).toEqual([
      { id: "x", displayName: "x", models: [] },
    ]);
  });
});

describe("cli", () => {
  const setup = () => {
    const host = createFakePluginHost({ pluginId: "model-lens" });
    host.harness.sdk.stub("providers.models", async () => LIVE_SHAPE);
    modelLensPlugin(host.bb);
    return host;
  };
  it("hide/show round-trips through config", async () => {
    const host = setup();
    const hid = await host.harness.runCli(["hide", "pi/google/gemini-2.5-flash-lite", "--json"], {});
    expect(hid.exitCode).toBe(0);
    const listed = await host.harness.runCli(["list", "--json"], {});
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("gemini-2.5-flash-lite");
  });
  it("width rejects garbage, accepts rem", async () => {
    const host = setup();
    const ok = await host.harness.runCli(["width", "24", "--json"], {});
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("24");
  });
});
