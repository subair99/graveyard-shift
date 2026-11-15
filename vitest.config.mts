import { defineConfig, defineProject } from "vitest/config";

// Sum of the file durations per proof project (task 19.1). `diagnostic().duration`
// is the accumulated duration of the tests and hooks in a file. Files run in
// parallel, so the sum can exceed the whole-run wall-clock. Informational only:
// the budget check lives in tests/proof/helpers/budgetGlobalSetup.ts. Defined
// inline because importing a .ts helper here makes Vite warn about its config loader.
const budgetReporter = {
  onTestRunEnd(testModules: ReadonlyArray<{ project: { name: string }; diagnostic(): { duration: number } }>) {
    const sums = new Map<string, number>();
    for (const module of testModules) {
      const name = module.project.name;
      if (!name.startsWith("proof-")) continue;
      sums.set(name, (sums.get(name) ?? 0) + module.diagnostic().duration);
    }
    for (const [name, ms] of sums) {
      console.log(
        `[budget] ${name}: ${(ms / 1000).toFixed(1)} s sum of file durations ` +
          "(files run in parallel, so the sum can exceed the wall-clock)",
      );
    }
  },
};

// Vitest 5: `test.projects` with inline `defineProject` entries. Inline projects
// inherit the root `setupFiles` (the network guard), so never set
// `extends: false` on a project. Projects run in parallel.
const budgetSetup = "tests/proof/helpers/budgetGlobalSetup.ts";

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
