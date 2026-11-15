// Synthetic package generator (task 11.3, design "Testing Strategy").
//
// A package is a list of functions, each built from a menu entry (`BEHAVIORS`). The package is
// written as plain CommonJS source (`package.json` with `main`, `index.js`). Everything here is
// deterministic: randomness comes only from fast-check, there is no clock and no `Math.random`
// in the generators. (The `random` behavior calls `Math.random` inside the generated package, only
// because the flaky-detection tests ask for a non-deterministic function.)
//
// Guaranteeing that an injected mutation is observable (`MutationInfo.observableOn`):
//   - "all-inputs": the mutated function differs from the original for EVERY input of the
//     behavior's argument arbitrary (the return value, the thrown error, the async outcome or the
//     argument post-state always differs). The unit test checks this with a property over the
//     arbitrary. Property 26 can rely on any case the harness draws from that arbitrary.
//   - "witness-only": the difference shows only for some inputs. The mutation then carries a
//     `witness` (a factory of fresh arguments) on which the difference is guaranteed, and the
//     property test must pass it as an explicit case. Never rely on random cases for these.
//   - API mutations (rename, add, remove an export, change arity) are visible in the export
//     surface comparison, independent of any input.
// Argument arbitraries return FRESH values on every draw (never `fc.constant(object)`), because
// functions in the menu mutate their arguments.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";

import type { TreeFile } from "../../../src/proof/shell/treeHash";

export type ErrorClassName = "Error" | "TypeError" | "RangeError";

export type BehaviorId =
  | "identity"
  | "sum"
  | "sortCopy"
  | "concat"
  | "upper"
  | "mapFilter"
  | "objectMerge"
  | "pathSet"
  | "pushArg"
  | "setPropArg"
  | "alwaysThrow"
  | "throwsOdd"
  | "asyncResolve"
  | "asyncReject"
  | "nanZero"
  | "holes"
  | "mapSet"
  | "dateRegex"
  | "typedArray"
  | "returnsUndefined"
  | "sharedRefs"
  | "cyclic"
  | "throwingGetter"
  | "throwingProxy"
  | "counter"
  | "random"
  | "absOfNegative"
  | "pollutesPrototype";

/** Input that makes `pollutesPrototype` add `POLLUTED_KEY` to `Object.prototype`. */
export const POLLUTE_INPUT = "__pollute__";
export const POLLUTED_KEY = "__gsPolluted";

export interface BehaviorParams {
  /** Integer 1..9 used as the behavior's constant. */
  constant: number;
  /** Text used as constant string or error message. */
  text: string;
  errorClass: ErrorClassName;
  /** Time value for `dateRegex`. */
  time: number;
  /** Behavior-specific mutation applied to this function, or null. */
  variant: string | null;
  /** Adds one unused trailing parameter (arity change). */
  extraParam: boolean;
}

export interface FunctionSpec {
  /** Own export name; also the function's `name`. */
  exportName: string;
  behavior: BehaviorId;
  params: BehaviorParams;
}

export interface SyntheticPackageSpec {
  name: string;
  version: string;
  functions: FunctionSpec[];
}

export interface UnencodableCounts {
  cycle: number;
  getter: number;
  proxy: number;
}

export type MutationKind =
  | "change-constant"
  | "swap-operator"
  | "change-message"
  | "change-error-class"
  | "change-return-type"
  | "change-return-value"
  | "drop-arg-mutation"
  | "add-arg-mutation"
  | "change-async-outcome"
  | "change-shared-copy"
  | "change-string-op"
  | "change-merge-order"
  | "change-arity"
  | "rename-export"
  | "add-export"
  | "remove-export"
  | "declared-delta";

export type ObservableOn = "all-inputs" | "witness-only";

interface BehaviorMutation {
  variant: string;
  kind: MutationKind;
  observableOn: ObservableOn;
  /** Fresh arguments on which the difference is guaranteed. */
  witness: () => unknown[];
  /** True for the one change that stands for a Declared_Delta (excluded from Property 26). */
  declaredDelta?: boolean;
}

interface Rendered {
  params: string[];
  body: string;
  /** Module-level code placed before the function (state for flaky functions). */
  prelude?: string;
}

export interface BehaviorDef {
  id: BehaviorId;
  /** Expected `length` of the exported function (before any change-arity mutation). */
  arity: number;
  /** False for functions whose result differs between two calls with equal inputs. */
  deterministic: boolean;
  /** Fresh arguments on each draw. */
  args: fc.Arbitrary<unknown[]>;
  /** Unencodable nodes in ONE Outcome of a call (return value), by reason. */
  unencodable: UnencodableCounts;
  render: (p: BehaviorParams, fnName: string) => Rendered;
  mutations: readonly BehaviorMutation[];
}

const NONE: UnencodableCounts = { cycle: 0, getter: 0, proxy: 0 };

const intArb = fc.integer({ min: -1000, max: 1000 });
const smallIntsArb = fc.array(intArb, { maxLength: 6 });
const textArb = fc.string({ maxLength: 6 });
const valueArb: fc.Arbitrary<unknown> = fc.oneof(intArb, textArb, smallIntsArb);
const objectArb = fc
  .record({ k: intArb, m: intArb }, { requiredKeys: [] })
  .map((o) => ({ ...o }));
const PATH_KEYS = ["p", "q", "r"] as const;
const pathArb = fc.array(fc.constantFrom(...PATH_KEYS), { minLength: 1, maxLength: 3 }).map((k) => k.join("."));

function tuple1<A>(a: fc.Arbitrary<A>): fc.Arbitrary<unknown[]> {
  return a.map((x): unknown[] => [x]);
}
function tuple2<A, B>(a: fc.Arbitrary<A>, b: fc.Arbitrary<B>): fc.Arbitrary<unknown[]> {
  return fc.tuple(a, b).map(([x, y]): unknown[] => [x, y]);
}

const lit = (value: string | number): string => JSON.stringify(value);

function throwBody(p: BehaviorParams): string {
  return `throw new ${p.errorClass}(${lit(p.text)});`;
}

const OTHER_CLASS: Readonly<Record<ErrorClassName, ErrorClassName>> = {
  Error: "TypeError",
  TypeError: "RangeError",
  RangeError: "Error",
};

function changedClass(p: BehaviorParams): ErrorClassName {
  return OTHER_CLASS[p.errorClass];
}

export const BEHAVIORS: Readonly<Record<BehaviorId, BehaviorDef>> = {
  identity: {
    id: "identity",
    arity: 1,
    deterministic: true,
    args: tuple1(valueArb),
    unencodable: NONE,
    render: (p) => ({ params: ["x"], body: p.variant === "change-return-type" ? "return { value: x };" : "return x;" }),
    mutations: [
      { variant: "change-return-type", kind: "change-return-type", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  sum: {
    id: "sum",
    arity: 2,
    deterministic: true,
    args: tuple2(intArb, intArb),
    unencodable: NONE,
    render: (p) => {
      const c = p.variant === "change-constant" ? p.constant + 1 : p.constant;
      const op = p.variant === "swap-operator" ? "-" : "+";
      return { params: ["a", "b"], body: `return a + b ${op} ${c};` };
    },
    mutations: [
      { variant: "change-constant", kind: "change-constant", observableOn: "all-inputs", witness: () => [1, 2] },
      { variant: "swap-operator", kind: "swap-operator", observableOn: "all-inputs", witness: () => [1, 2] },
    ],
  },
  sortCopy: {
    id: "sortCopy",
    arity: 1,
    deterministic: true,
    args: tuple1(smallIntsArb),
    unencodable: NONE,
    render: (p) => {
      if (p.variant === "add-arg-mutation") return { params: ["arr"], body: "return arr.sort((x, y) => x - y);" };
      const tail = p.variant === "change-return-value" ? `.concat([${p.constant}])` : "";
      return { params: ["arr"], body: `return arr.slice().sort((x, y) => x - y)${tail};` };
    },
    mutations: [
      { variant: "change-return-value", kind: "change-return-value", observableOn: "all-inputs", witness: () => [[3, 1]] },
      // Sorting in place changes the argument only when it was not already sorted.
      { variant: "add-arg-mutation", kind: "add-arg-mutation", observableOn: "witness-only", witness: () => [[2, 1]] },
    ],
  },
  concat: {
    id: "concat",
    arity: 2,
    deterministic: true,
    args: tuple2(textArb, textArb),
    unencodable: NONE,
    render: (p) => ({
      params: ["a", "b"],
      body: `return a + b + ${lit(p.variant === "change-constant" ? `${p.text}!` : p.text)};`,
    }),
    mutations: [
      { variant: "change-constant", kind: "change-constant", observableOn: "all-inputs", witness: () => ["a", "b"] },
    ],
  },
  upper: {
    id: "upper",
    arity: 1,
    deterministic: true,
    args: tuple1(textArb),
    unencodable: NONE,
    render: (p) => ({ params: ["s"], body: p.variant === "change-string-op" ? "return s.toLowerCase();" : "return s.toUpperCase();" }),
    mutations: [
      { variant: "change-string-op", kind: "change-string-op", observableOn: "witness-only", witness: () => ["Ab"] },
    ],
  },
  mapFilter: {
    id: "mapFilter",
    arity: 1,
    deterministic: true,
    args: tuple1(smallIntsArb),
    unencodable: NONE,
    render: (p) => {
      const c = p.variant === "change-constant" ? p.constant + 1 : p.constant;
      return { params: ["arr"], body: `return arr.filter((x) => x % 2 === 0).map((x) => x * ${c});` };
    },
    mutations: [
      // Differs only when the array holds a non-zero even element.
      { variant: "change-constant", kind: "change-constant", observableOn: "witness-only", witness: () => [[2, 3]] },
    ],
  },
  objectMerge: {
    id: "objectMerge",
    arity: 2,
    deterministic: true,
    args: tuple2(objectArb, objectArb),
    unencodable: NONE,
    render: (p) => ({
      params: ["a", "b"],
      body: p.variant === "change-merge-order" ? "return Object.assign({}, b, a);" : "return Object.assign({}, a, b);",
    }),
    mutations: [
      // Differs only when both objects hold the same key with different values.
      { variant: "change-merge-order", kind: "change-merge-order", observableOn: "witness-only", witness: () => [{ k: 1 }, { k: 2 }] },
    ],
  },
  pathSet: {
    id: "pathSet",
    arity: 3,
    deterministic: true,
    args: fc.tuple(fc.record({ other: intArb }), pathArb, intArb).map(([o, path, v]): unknown[] => [o, path, v]),
    unencodable: NONE,
    render: (p) => ({
      params: ["obj", "path", "value"],
      body: [
        p.variant === "drop-arg-mutation" ? "obj = JSON.parse(JSON.stringify(obj));" : "",
        "const keys = path.split('.');",
        "let cur = obj;",
        "for (let i = 0; i < keys.length - 1; i++) {",
        "  if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};",
        "  cur = cur[keys[i]];",
        "}",
        "cur[keys[keys.length - 1]] = value;",
        "return obj;",
      ].join("\n"),
    }),
    mutations: [
      // The argument never has the path keys (`p`, `q`, `r`) before the call, so the post-state differs.
      { variant: "drop-arg-mutation", kind: "drop-arg-mutation", observableOn: "all-inputs", witness: () => [{ other: 0 }, "p.q", 1] },
    ],
  },
  pushArg: {
    id: "pushArg",
    arity: 2,
    deterministic: true,
    args: tuple2(smallIntsArb, intArb),
    unencodable: NONE,
    render: (p) => ({
      params: ["arr", "x"],
      body: p.variant === "drop-arg-mutation" ? "return arr.length + 1;" : "arr.push(x);\nreturn arr.length;",
    }),
    mutations: [
      // The return value stays equal; only the argument post-state differs.
      { variant: "drop-arg-mutation", kind: "drop-arg-mutation", observableOn: "all-inputs", witness: () => [[1], 2] },
    ],
  },
  setPropArg: {
    id: "setPropArg",
    arity: 2,
    deterministic: true,
    args: tuple2(fc.record({ other: intArb }), intArb),
    unencodable: NONE,
    render: (p) => ({
      params: ["obj", "v"],
      body: p.variant === "drop-arg-mutation" ? "return v;" : "obj.touched = v;\nreturn v;",
    }),
    mutations: [
      { variant: "drop-arg-mutation", kind: "drop-arg-mutation", observableOn: "all-inputs", witness: () => [{ other: 0 }, 1] },
    ],
  },
  alwaysThrow: {
    id: "alwaysThrow",
    arity: 1,
    deterministic: true,
    args: tuple1(valueArb),
    unencodable: NONE,
    render: (p) => {
      const q = { ...p, text: p.variant === "change-message" ? `${p.text}!` : p.text, errorClass: p.variant === "change-error-class" ? changedClass(p) : p.errorClass };
      return { params: ["x"], body: throwBody(q) };
    },
    mutations: [
      { variant: "change-message", kind: "change-message", observableOn: "all-inputs", witness: () => [1] },
      { variant: "change-error-class", kind: "change-error-class", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  throwsOdd: {
    id: "throwsOdd",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (p) => {
      const q = { ...p, text: p.variant === "change-message" ? `${p.text}!` : p.text, errorClass: p.variant === "change-error-class" ? changedClass(p) : p.errorClass };
      return { params: ["x"], body: `if (x % 2 !== 0) { ${throwBody(q)} }\nreturn x;` };
    },
    mutations: [
      // Only odd inputs throw, so the witness is odd.
      { variant: "change-message", kind: "change-message", observableOn: "witness-only", witness: () => [1] },
      { variant: "change-error-class", kind: "change-error-class", observableOn: "witness-only", witness: () => [1] },
    ],
  },
  asyncResolve: {
    id: "asyncResolve",
    arity: 1,
    deterministic: true,
    args: tuple1(valueArb),
    unencodable: NONE,
    render: (p) => ({
      params: ["x"],
      body: p.variant === "change-async-outcome" ? `return Promise.reject(new ${p.errorClass}(${lit(p.text)}));` : "return Promise.resolve(x);",
    }),
    mutations: [
      { variant: "change-async-outcome", kind: "change-async-outcome", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  asyncReject: {
    id: "asyncReject",
    arity: 1,
    deterministic: true,
    args: tuple1(valueArb),
    unencodable: NONE,
    render: (p) => {
      if (p.variant === "change-async-outcome") return { params: ["x"], body: "return Promise.resolve(x);" };
      const text = p.variant === "change-message" ? `${p.text}!` : p.text;
      return { params: ["x"], body: `return Promise.reject(new ${p.errorClass}(${lit(text)}));` };
    },
    mutations: [
      { variant: "change-async-outcome", kind: "change-async-outcome", observableOn: "all-inputs", witness: () => [1] },
      { variant: "change-message", kind: "change-message", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  nanZero: {
    id: "nanZero",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (p) => ({ params: ["x"], body: p.variant === "change-return-value" ? "return [NaN, 0];" : "return [NaN, -0];" }),
    mutations: [
      { variant: "change-return-value", kind: "change-return-value", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  holes: {
    id: "holes",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (p) => ({ params: ["x"], body: p.variant === "change-return-value" ? "return [1, undefined, 3];" : "return [1, , 3];" }),
    mutations: [
      { variant: "change-return-value", kind: "change-return-value", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  mapSet: {
    id: "mapSet",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (p) => ({
      params: ["x"],
      body: `return [new Map([["k", x]]), new Set([x${p.variant === "change-return-value" ? `, ${p.constant + 2000}` : ""}])];`,
    }),
    mutations: [
      // The added Set item is outside the argument range (-1000..1000), so it is always new.
      { variant: "change-return-value", kind: "change-return-value", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  dateRegex: {
    id: "dateRegex",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (p) => ({ params: ["x"], body: `return [new Date(${p.variant === "change-constant" ? p.time + 1 : p.time}), /ab+/gi];` }),
    mutations: [
      { variant: "change-constant", kind: "change-constant", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  typedArray: {
    id: "typedArray",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (p) => ({
      params: ["x"],
      body: `return new Uint8Array([x & 255, ${p.variant === "change-constant" ? p.constant + 1 : p.constant}]);`,
    }),
    mutations: [
      { variant: "change-constant", kind: "change-constant", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  returnsUndefined: {
    id: "returnsUndefined",
    arity: 1,
    deterministic: true,
    args: tuple1(valueArb),
    unencodable: NONE,
    render: (p) => ({ params: ["x"], body: p.variant === "change-return-type" ? "return null;" : "return undefined;" }),
    mutations: [
      { variant: "change-return-type", kind: "change-return-type", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  sharedRefs: {
    id: "sharedRefs",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (p) => ({
      params: ["x"],
      body: `const o = { v: x };\nreturn [o, ${p.variant === "change-shared-copy" ? 'Object.assign({}, o, { v: "changed" })' : "o"}];`,
    }),
    mutations: [
      // Only the second copy changes; `v` is a number in the original and a string in the copy.
      { variant: "change-shared-copy", kind: "change-shared-copy", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  cyclic: {
    id: "cyclic",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: { cycle: 1, getter: 0, proxy: 0 },
    render: (p) => ({
      params: ["x"],
      body: `const o = { v: ${p.variant === "change-return-type" ? "[x]" : "x"} };\no.self = o;\nreturn o;`,
    }),
    mutations: [
      { variant: "change-return-type", kind: "change-return-type", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  throwingGetter: {
    id: "throwingGetter",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: { cycle: 0, getter: 1, proxy: 0 },
    render: (p) => ({
      params: ["x"],
      body: [
        `const o = { v: ${p.variant === "change-return-type" ? "[x]" : "x"} };`,
        'Object.defineProperty(o, "bad", { enumerable: true, get() { throw new Error("boom"); } });',
        "return o;",
      ].join("\n"),
    }),
    mutations: [
      { variant: "change-return-type", kind: "change-return-type", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  throwingProxy: {
    id: "throwingProxy",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: { cycle: 0, getter: 0, proxy: 1 },
    render: (p) => ({
      params: ["x"],
      body: `return { v: ${p.variant === "change-return-type" ? "[x]" : "x"}, p: new Proxy({}, { ownKeys() { throw new Error("trap"); } }) };`,
    }),
    mutations: [
      { variant: "change-return-type", kind: "change-return-type", observableOn: "all-inputs", witness: () => [1] },
    ],
  },
  counter: {
    id: "counter",
    arity: 1,
    deterministic: false,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (_p, fnName) => ({
      params: ["x"],
      prelude: `let counter_${fnName} = 0;`,
      body: `counter_${fnName} += 1;\nreturn counter_${fnName};`,
    }),
    mutations: [],
  },
  random: {
    id: "random",
    arity: 1,
    deterministic: false,
    args: tuple1(intArb),
    unencodable: NONE,
    render: () => ({ params: ["x"], body: "return Math.random();" }),
    mutations: [],
  },
  absOfNegative: {
    id: "absOfNegative",
    arity: 1,
    deterministic: true,
    args: tuple1(intArb),
    unencodable: NONE,
    render: (p) => ({ params: ["x"], body: p.variant === "declared-delta" ? "return x < 0 ? -x : x;" : "return x;" }),
    mutations: [
      // A stand-in for a Declared_Delta: the Resurrection returns the absolute value of a negative input.
      { variant: "declared-delta", kind: "declared-delta", observableOn: "witness-only", witness: () => [-3], declaredDelta: true },
    ],
  },
  pollutesPrototype: {
    id: "pollutesPrototype",
    arity: 1,
    deterministic: true,
    args: tuple1(fc.oneof(textArb, fc.constant(POLLUTE_INPUT))),
    unencodable: NONE,
    render: () => ({
      params: ["x"],
      body: `if (x === ${lit(POLLUTE_INPUT)}) { Object.prototype.${POLLUTED_KEY} = true; }\nreturn x;`,
    }),
    mutations: [],
  },
};

/** Behaviors that return the same result for equal inputs and have no side effect outside the arguments. */
export const DETERMINISTIC_BEHAVIORS: readonly BehaviorId[] = (Object.keys(BEHAVIORS) as BehaviorId[]).filter(
  (id) => BEHAVIORS[id].deterministic && id !== "pollutesPrototype" && id !== "absOfNegative",
);
export const ALL_BEHAVIORS: readonly BehaviorId[] = Object.keys(BEHAVIORS) as BehaviorId[];

const paramsArb: fc.Arbitrary<BehaviorParams> = fc.record({
  constant: fc.integer({ min: 1, max: 9 }),
  text: fc.constantFrom("alpha", "beta", "gamma x", "d\u00e9j\u00e0"),
  errorClass: fc.constantFrom<ErrorClassName>("Error", "TypeError", "RangeError"),
  time: fc.integer({ min: 0, max: 1_000_000_000_000 }),
  variant: fc.constant(null),
  extraParam: fc.constant(false),
});

export interface SyntheticPackageOptions {
  /** Menu entries to draw from (default: `DETERMINISTIC_BEHAVIORS`). */
  behaviors?: readonly BehaviorId[];
  minFunctions?: number;
  maxFunctions?: number;
}

/** A small package: `functions` drawn from the menu, export names `<behavior><index>`. */
export function syntheticPackageArb(options: SyntheticPackageOptions = {}): fc.Arbitrary<SyntheticPackageSpec> {
  const menu = options.behaviors ?? DETERMINISTIC_BEHAVIORS;
  if (menu.length === 0) throw new Error("empty behavior menu");
  return fc
    .record({
      n: fc.integer({ min: 1, max: 999 }),
      major: fc.integer({ min: 0, max: 9 }),
      minor: fc.integer({ min: 0, max: 9 }),
      patch: fc.integer({ min: 0, max: 9 }),
      functions: fc.array(fc.record({ behavior: fc.constantFrom(...menu), params: paramsArb }), {
        minLength: options.minFunctions ?? 1,
        maxLength: options.maxFunctions ?? 4,
      }),
    })
    .map(({ n, major, minor, patch, functions }) => ({
      name: `synth-${n}`,
      version: `${major}.${minor}.${patch}`,
      functions: functions.map((f, i) => ({ exportName: `${f.behavior}${i}`, behavior: f.behavior, params: f.params })),
    }));
}

/** Source text of one exported function (declaration plus `exports` assignment). */
function renderFunction(fn: FunctionSpec): string {
  const r = BEHAVIORS[fn.behavior].render(fn.params, fn.exportName);
  const params = fn.params.extraParam ? [...r.params, "_extra"] : r.params;
  const body = r.body
    .split("\n")
    .map((line) => (line === "" ? "" : `  ${line}`))
    .filter((line) => line !== "")
    .join("\n");
  return [
    ...(r.prelude === undefined ? [] : [r.prelude]),
    `function ${fn.exportName}(${params.join(", ")}) {`,
    body,
    "}",
    `exports.${fn.exportName} = ${fn.exportName};`,
  ].join("\n");
}

/** Content of `index.js` (CommonJS). */
export function renderIndexJs(spec: SyntheticPackageSpec): string {
  return `"use strict";\n\n${spec.functions.map(renderFunction).join("\n\n")}\n`;
}

/** Content of `package.json`: CommonJS (no `type`), `main`, MIT license. */
export function renderPackageJson(spec: SyntheticPackageSpec): string {
  return `${JSON.stringify({ name: spec.name, version: spec.version, main: "index.js", license: "MIT" }, null, 2)}\n`;
}

/** Files of the package, paths relative to the package root. */
export function packageFiles(spec: SyntheticPackageSpec): TreeFile[] {
  return [
    { path: "package.json", bytes: new TextEncoder().encode(renderPackageJson(spec)) },
    { path: "index.js", bytes: new TextEncoder().encode(renderIndexJs(spec)) },
  ];
}

/** Writes `package.json` and `index.js` into `dir` (created when missing). */
export function writePackage(spec: SyntheticPackageSpec, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const file of packageFiles(spec)) writeFileSync(join(dir, file.path), file.bytes);
}

/** Expected arity of an exported function, including a change-arity mutation. */
export function expectedArity(fn: FunctionSpec): number {
  return BEHAVIORS[fn.behavior].arity + (fn.params.extraParam ? 1 : 0);
}

/** Expected own export names, sorted by code unit order. */
export function expectedExportNames(spec: SyntheticPackageSpec): string[] {
  return spec.functions.map((f) => f.exportName).sort();
}

export function argsArbFor(fn: FunctionSpec): fc.Arbitrary<unknown[]> {
  return BEHAVIORS[fn.behavior].args;
}

// ---------------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------------

export interface MutationRequest {
  kind: MutationKind;
  /** Index of the target function in `spec.functions`. */
  target: number;
}

export type MutationEffect = "value" | "argument" | "async" | "api";

export interface MutationInfo {
  kind: MutationKind;
  /** Export name in the ORIGINAL spec, or the added name for `add-export`. */
  exportName: string;
  /** Export name in the mutated spec (differs only for `rename-export`; null for `remove-export`). */
  mutatedExportName: string | null;
  effect: MutationEffect;
  observableOn: ObservableOn;
  /**
   * Fresh arguments on which the difference is guaranteed. For `observableOn: "all-inputs"` any
   * input of the behavior's arbitrary works; for "witness-only" the test MUST use this input as
   * an explicit case. Null for API mutations (the export surface differs regardless of input).
   */
  witness: (() => unknown[]) | null;
  /** True when the change stands for a Declared_Delta, so Property 26 must not expect `restless`. */
  declaredDelta: boolean;
}

export interface MutatedPackage {
  spec: SyntheticPackageSpec;
  info: MutationInfo;
}

function effectOf(kind: MutationKind): MutationEffect {
  switch (kind) {
    case "drop-arg-mutation":
    case "add-arg-mutation":
      return "argument";
    case "change-async-outcome":
      return "async";
    case "change-arity":
    case "rename-export":
    case "add-export":
    case "remove-export":
      return "api";
    default:
      return "value";
  }
}

function behaviorMutation(fn: FunctionSpec, kind: MutationKind): BehaviorMutation | undefined {
  return BEHAVIORS[fn.behavior].mutations.find((m) => m.kind === kind);
}

/** Every mutation that applies to `spec`, in a fixed order. */
export function listMutations(spec: SyntheticPackageSpec): MutationRequest[] {
  const out: MutationRequest[] = [];
  spec.functions.forEach((fn, target) => {
    for (const m of BEHAVIORS[fn.behavior].mutations) out.push({ kind: m.kind, target });
    out.push({ kind: "change-arity", target });
    out.push({ kind: "rename-export", target });
    if (spec.functions.length >= 2) out.push({ kind: "remove-export", target });
  });
  out.push({ kind: "add-export", target: 0 });
  return out;
}

function copySpec(spec: SyntheticPackageSpec): SyntheticPackageSpec {
  return {
    name: spec.name,
    version: spec.version,
    functions: spec.functions.map((f) => ({ ...f, params: { ...f.params } })),
  };
}

/**
 * Returns a COPY of `spec` with one behavior change injected, plus metadata. The input spec is
 * never modified. Throws when the request does not apply (see `listMutations`).
 */
export function mutate(spec: SyntheticPackageSpec, request: MutationRequest): MutatedPackage {
  const copy = copySpec(spec);
  const original = spec.functions[request.target];
  if (original === undefined) throw new Error(`no function at index ${request.target}`);
  const target = copy.functions[request.target] as FunctionSpec;
  const base = { kind: request.kind, effect: effectOf(request.kind), declaredDelta: false };

  switch (request.kind) {
    case "change-arity":
      if (original.params.extraParam) throw new Error("arity already changed");
      target.params.extraParam = true;
      return {
        spec: copy,
        info: { ...base, exportName: original.exportName, mutatedExportName: original.exportName, observableOn: "all-inputs", witness: null },
      };
    case "rename-export": {
      const renamed = `${original.exportName}Renamed`;
      target.exportName = renamed;
      return {
        spec: copy,
        info: { ...base, exportName: original.exportName, mutatedExportName: renamed, observableOn: "all-inputs", witness: null },
      };
    }
    case "remove-export":
      if (spec.functions.length < 2) throw new Error("cannot remove the only export");
      copy.functions.splice(request.target, 1);
      return {
        spec: copy,
        info: { ...base, exportName: original.exportName, mutatedExportName: null, observableOn: "all-inputs", witness: null },
      };
    case "add-export": {
      const added = `added${spec.functions.length}`;
      copy.functions.push({ exportName: added, behavior: "identity", params: { ...original.params, variant: null, extraParam: false } });
      return {
        spec: copy,
        info: { ...base, exportName: added, mutatedExportName: added, observableOn: "all-inputs", witness: null },
      };
    }
    default: {
      const m = behaviorMutation(original, request.kind);
      if (m === undefined) throw new Error(`${request.kind} does not apply to ${original.behavior}`);
      if (original.params.variant !== null) throw new Error("function already mutated");
      target.params.variant = m.variant;
      return {
        spec: copy,
        info: {
          ...base,
          exportName: original.exportName,
          mutatedExportName: original.exportName,
          observableOn: m.observableOn,
          witness: m.witness,
          declaredDelta: m.declaredDelta === true,
        },
      };
    }
  }
}

export interface MutationArbOptions {
  /** Include the declared-delta stand-in (default false: Property 26 needs changes outside every delta). */
  includeDeclaredDelta?: boolean;
}

/** Picks one applicable mutation of `spec` and applies it to a copy. */
export function mutationOfArb(spec: SyntheticPackageSpec, options: MutationArbOptions = {}): fc.Arbitrary<MutatedPackage> {
  const requests = listMutations(spec).filter((r) => {
    if (options.includeDeclaredDelta === true) return true;
    const fn = spec.functions[r.target];
    return fn === undefined || behaviorMutation(fn, r.kind)?.declaredDelta !== true;
  });
  return fc.constantFrom(...requests).map((r) => mutate(spec, r));
}

/** A package together with one injected change. */
export function mutatedPackageArb(
  options: SyntheticPackageOptions & MutationArbOptions = {},
): fc.Arbitrary<{ original: SyntheticPackageSpec; mutated: MutatedPackage }> {
  return syntheticPackageArb(options).chain((original) =>
    mutationOfArb(original, options).map((mutated) => ({ original, mutated })),
  );
}
