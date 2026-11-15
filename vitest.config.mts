import { configDefaults, defineConfig, defineProject } from "vitest/config";

// Vitest 5: `test.projects` with inline `defineProject` entries. Inline projects
// inherit the root `setupFiles` (the network guard), so never set
// `extends: false` on a project. Projects run in parallel.
// The time budget is checked per project by the reporter in tests/proof/helpers/budgetReporter.ts.
const budgetReporter = "./tests/proof/helpers/budgetReporter.ts";

// Files that run 100 engine runs each; they have their own project and budget (target 90 s).
const heavyFiles = [
  "tests/proof/property/p24-same-seed-same-bytes.test.ts",
  "tests/proof/property/p26-injected-changes.test.ts",
  "tests/proof/property/p26b-declared-delta.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    reporters: ["default", budgetReporter],
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
          exclude: [...configDefaults.exclude, ...heavyFiles],
          testTimeout: 60000,
        },
      }),
      defineProject({
        test: {
          name: "proof-heavy",
          include: heavyFiles,
          testTimeout: 60000,
        },
      }),
      defineProject({
        test: {
          name: "proof-integration",
          include: ["tests/proof/integration/**/*.test.ts"],
          testTimeout: 60000,
        },
      }),
    ],
  },
});
