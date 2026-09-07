import { describe, it, expect } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { defaultModes } from "./default-modes.js";

async function hostWithPlugin() {
  const host = createFakePluginHost({ pluginId: "composer-modes" });
  await plugin(host.bb);
  return host;
}

describe("composer-modes", () => {
  it("returns defaults when empty", async () => {
    const host = await hostWithPlugin();
    const res = (await host.harness.callRpc("getModes", null)) as { modes: { id: string }[]; activeModeId: string };
    expect(res.modes.length).toBe(defaultModes.length);
    expect(res.activeModeId).toBe("agent");
  });
  it("saves custom persona and toggles", async () => {
    const host = await hostWithPlugin();
    await host.harness.callRpc("saveMode", {
      id: "tailwind-designer",
      name: "Tailwind Designer",
      icon: "🎨",
      color: "violet",
      description: "Tailwind utility expert",
      promptPrefix: "You are a Tailwind designer",
      permissionMode: "full",
      skills: [],
      isEnabled: true,
    } as never);
    let res = (await host.harness.callRpc("getModes", null)) as { modes: { id: string; isEnabled: boolean }[] };
    expect(res.modes.some((m) => m.id === "tailwind-designer")).toBe(true);
    await host.harness.callRpc("toggleMode", { id: "tailwind-designer", isEnabled: false } as never);
    res = (await host.harness.callRpc("getModes", null)) as { modes: { id: string; isEnabled: boolean }[] };
    expect(res.modes.find((m) => m.id === "tailwind-designer")?.isEnabled).toBe(false);
  });
  it("rejects deleting the only remaining persona", async () => {
    const host = await hostWithPlugin();
    const res = (await host.harness.callRpc("getModes", null)) as { modes: { id: string }[] };
    for (let i = 0; i < res.modes.length - 1; i++) {
      await host.harness.callRpc("deleteMode", { id: res.modes[i]!.id } as never);
    }
    const last = res.modes[res.modes.length - 1]!.id;
    await expect(host.harness.callRpc("deleteMode", { id: last } as never)).rejects.toThrow(
      "cannot delete the only remaining persona",
    );
  });
  it("deletes any mode", async () => {
    const host = await hostWithPlugin();
    await host.harness.callRpc("deleteMode", { id: "seo" } as never);
    const res = (await host.harness.callRpc("getModes", null)) as { modes: { id: string }[] };
    expect(res.modes.some((m) => m.id === "seo")).toBe(false);
  });
});
