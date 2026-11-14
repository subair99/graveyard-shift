import babelParser from "@babel/eslint-parser";

/** Files where the clock and randomness are banned (Requirement 10.2). */
export const deterministicFiles = [
  "src/engine/core/**/*.ts",
  "src/engine/serialize/**/*.ts",
];

export const deterministicRules = {
  "no-restricted-properties": [
    "error",
    {
      object: "Date",
      property: "now",
      message: "Date.now is banned in deterministic code. Take the time from the Clock or analysisDate.",
    },
    {
      object: "Math",
      property: "random",
      message: "Math.random is banned in deterministic code.",
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: "new Date() without arguments reads the system clock. Pass an explicit value.",
    },
  ],
};

// typescript-eslint does not support TypeScript 7 (peer range <6.1.0), so
// @babel/eslint-parser with Babel's typescript syntax plugin parses TS files.
function tsConfig(files, plugins) {
  return {
    files,
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins } },
      },
    },
  };
}

export default [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  tsConfig(["**/*.ts", "**/*.mts"], ["typescript"]),
  tsConfig(["**/*.tsx"], ["typescript", "jsx"]),
  {
    files: deterministicFiles,
    rules: deterministicRules,
  },
];
