import { defineConfig, defineProject } from "vitest/config";

// Vitest 5: `test.projects` with inline `defineProject` entries. Inline projects
// inherit the root `setupFiles` (the network guard), so never set
// `extends: false` on a project. Projects run in parallel.
const budgetSetup = "tests/proof/helpers/budgetGlobalSetup.ts";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/setup/networkGuard.ts"],
    projects: [
      defineProject({
        test: {
          name: "engine",
          include: ["tests/engine/**/*.test.ts"],
        },
      }),
      defineProject({
        test: {
          name: "proof-property",
          include: ["tests/proof/property/**/*.test.ts", "tests/proof/unit/**/*.test.ts"],
          testTimeout: 60000,
          globalSetup: [budgetSetup],
        },
      }),
      defineProject({
        test: {
          name: "proof-integration",
          include: ["tests/proof/integration/**/*.test.ts"],
          testTimeout: 60000,
          globalSetup: [budgetSetup],
        },
      }),
    ],
  },
});
