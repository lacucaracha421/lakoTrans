import { beforeAll } from "vitest";
import { mcpAppEnvironment } from "./mcpAppEnvironment.fixture";

// Vitest 5's first transformation of the full native session graph can exceed
// the behavior-test budget on Node 22. Load it under an isolated Electron/data
// boundary in setup; each test still resets modules and owns fresh app state.
// Keep the existing 15-second behavior timeout, including all real operations.
beforeAll(async () => {
  const environment = await mcpAppEnvironment();
  try {
    await import("../src/main/mcp/mcpPageOperationSession");
  } finally {
    await environment.close();
  }
}, 60000);
