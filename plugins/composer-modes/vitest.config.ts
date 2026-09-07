import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: { environment: "node", include: ["server.test.ts"] },
});
