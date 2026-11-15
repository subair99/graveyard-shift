// Generators of values for the Value_Codec property tests (Property 8).
// `valueArb`: encodable values (no cycles, no throwing getters, no proxies).
// `cyclicValueArb`: values that contain at least one cycle.
// `sharedValueArb`: values with shared, non-cyclic references (DAGs).
import { fc } from "../../engine/helpers/fc";

function put(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function putAll(target: object, entries: readonly (readonly [string, unknown])[]): void {
  for (const [k, v] of entries) put(target, k, v);
}

const text = fc.string({ unit: "binary", maxLength: 6 });
/** Keys for plain objects and class instances, with the awkward ones included. */
const objectKey = fc.oneof(
  { arbitrary: text, weight: 6 },
  {
    arbitrary: fc.constantFrom("__proto__", "constructor", "toString", "", "0", "01", "length", "stack"),
    weight: 2,
  },
);
/** Keys for arrays and errors: never an index, `message` or `stack`. */
const extraKey = text.map((s) => "p" + s);

const className = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,8}$/).map((s) => "Cls" + s);
const errorClassName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,8}$/).map((s) => "Err" + s);

const regexpSources = ["a+b", "^x$", "[a-z]*", "(?:foo|bar)", "\\d{2,3}", "\\/", "", "a|b", "\\w+\\s?"];
const regexpFlags = fc.subarray(["d", "g", "i", "m", "s", "u", "y"]).map((f) => f.join(""));

const typedKinds = [
  ["Int8Array", Int8Array, 1],
  ["Uint8Array", Uint8Array, 1],
  ["Uint8ClampedArray", Uint8ClampedArray, 1],
  ["Int16Array", Int16Array, 2],
  ["Uint16Array", Uint16Array, 2],
  ["Int32Array", Int32Array, 4],
  ["Uint32Array", Uint32Array, 4],
  ["Float32Array", Float32Array, 4],
  ["Float64Array", Float64Array, 8],
  ["BigInt64Array", BigInt64Array, 8],
  ["BigUint64Array", BigUint64Array, 8],
] as const;

type TypedCtor = new (buffer: ArrayBuffer, byteOffset?: number, length?: number) => ArrayBufferView;

const bytes = fc.uint8Array({ minLength: 64, maxLength: 64 });

const typedArb: fc.Arbitrary<unknown> = fc
  .tuple(fc.integer({ min: 0, max: typedKinds.length + 1 }), fc.integer({ min: 0, max: 6 }), bytes, fc.boolean())
  .map(([which, count, data, offset]) => {
    if (which === typedKinds.length) return Buffer.from(data.subarray(0, count));
    if (which === typedKinds.length + 1) {
      const ab = new ArrayBuffer(count);
      new Uint8Array(ab).set(data.subarray(0, count));
      return new DataView(ab);
    }
    const [, ctor, size] = typedKinds[which]!;
    const lead = offset ? 8 : 0;
    const ab = new ArrayBuffer(lead + count * size);
    new Uint8Array(ab).set(data.subarray(0, lead + count * size));
    return new (ctor as unknown as TypedCtor)(ab, lead, count);
  });

const arrayBufferArb: fc.Arbitrary<unknown> = fc.uint8Array({ maxLength: 12 }).map((u) => {
  const ab = new ArrayBuffer(u.length);
  new Uint8Array(ab).set(u);
  return ab;
});

const functionArb: fc.Arbitrary<unknown> = fc
  .tuple(text, fc.integer({ min: 0, max: 5 }))
  .map(([name, arity]) => {
    const f = function () {};
    Object.defineProperty(f, "name", { value: name, configurable: true });
    Object.defineProperty(f, "length", { value: arity, configurable: true });
    return f;
  });

const dateArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: -8.64e15, max: 8.64e15 }).map((t) => new Date(t)),
  fc.constant(0).map(() => new Date(NaN)),
);

const numberArb: fc.Arbitrary<number> = fc.oneof(
  fc.double(),
  fc.integer(),
  fc.constantFrom(NaN, Infinity, -Infinity, -0, 0, Number.MAX_VALUE, Number.MIN_VALUE),
);

const leafArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  text,
  numberArb,
  fc.bigInt({ min: -(2n ** 80n), max: 2n ** 80n }),
  fc.oneof(text.map((d) => Symbol(d)), fc.constant(0).map(() => Symbol())),
  dateArb,
  fc.tuple(fc.constantFrom(...regexpSources), regexpFlags).map(([s, f]) => new RegExp(s, f)),
  arrayBufferArb,
  typedArb,
  functionArb,
);

const builtinErrors = [Error, TypeError, RangeError, SyntaxError, EvalError, ReferenceError, URIError] as const;

function makeError(kind: number, custom: string, message: string, props: readonly (readonly [string, unknown])[]): Error {
  let e: Error;
  if (kind < builtinErrors.length) {
    e = new builtinErrors[kind]!(message);
  } else {
    const Custom = { [custom]: class extends Error {} }[custom] as ErrorConstructor;
    e = new Custom(message);
  }
  putAll(e, props);
  return e;
}

function makeInstance(name: string, entries: readonly (readonly [string, unknown])[]): object {
  const Cls = { [name]: class {} }[name] as new () => object;
  const o = new Cls();
  putAll(o, entries);
  return o;
}

function makeSparse(
  length: number,
  items: readonly (readonly [number, unknown])[],
  props: readonly (readonly [string, unknown])[],
): unknown[] {
  const a = new Array<unknown>(length);
  for (const [i, v] of items) if (i < length) put(a, String(i), v);
  putAll(a, props);
  return a;
}

const { value: treeArb } = fc.letrec<{ value: unknown }>((tie) => {
  const child = tie("value");
  const entries = fc.array(fc.tuple(objectKey, child), { maxLength: 4 });
  const extras = fc.array(fc.tuple(extraKey, child), { maxLength: 2 });
  return {
    value: fc.oneof(
      { depthSize: "small", maxDepth: 4, withCrossShrink: true },
      { arbitrary: leafArb, weight: 4 },
      fc.array(child, { maxLength: 4 }),
      fc
        .tuple(
          fc.integer({ min: 0, max: 6 }),
          fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), child), { maxLength: 4 }),
          extras,
        )
        .map(([len, items, props]) => makeSparse(len, items, props)),
      entries.map((e) => {
        const o = {};
        putAll(o, e);
        return o;
      }),
      entries.map((e) => {
        const o = Object.create(null) as object;
        putAll(o, e);
        return o;
      }),
      fc.tuple(className, entries).map(([n, e]) => makeInstance(n, e)),
      fc.array(fc.tuple(child, child), { maxLength: 3 }).map((e) => new Map(e)),
      fc.array(child, { maxLength: 3 }).map((e) => new Set(e)),
      fc
        .tuple(fc.integer({ min: 0, max: builtinErrors.length }), errorClassName, text, extras)
        .map(([k, c, m, p]) => makeError(k, c, m, p)),
      // Shared, non-cyclic references.
      child.map((o) => [o, o]),
      child.map((o) => ({ a: o, b: o, c: [o] })),
    ),
  };
});

/** Encodable values of every type the codec supports. */
export const valueArb: fc.Arbitrary<unknown> = treeArb;

type Linker = (from: unknown, to: unknown, keyLink: boolean) => void;
const makers: readonly { make: () => unknown; link: Linker }[] = [
  { make: () => ({}), link: (f, t) => put(f as object, "next", t) },
  { make: () => Object.create(null) as object, link: (f, t) => put(f as object, "next", t) },
  { make: () => [], link: (f, t) => (f as unknown[]).push(t) },
  {
    make: () => new Map<unknown, unknown>(),
    link: (f, t, keyLink) => (keyLink ? (f as Map<unknown, unknown>).set(t, 1) : (f as Map<unknown, unknown>).set("next", t)),
  },
  { make: () => new Set<unknown>(), link: (f, t) => (f as Set<unknown>).add(t) },
  { make: () => makeInstance("CycleNode", []), link: (f, t) => put(f as object, "next", t) },
];

/**
 * A ring of 1 to 4 containers (self-reference when 1, mutual references when 2 or more) through
 * objects, arrays, Maps and Sets, optionally embedded in an encodable value.
 */
export const cyclicValueArb: fc.Arbitrary<unknown> = fc
  .tuple(
    fc.array(fc.integer({ min: 0, max: makers.length - 1 }), { minLength: 1, maxLength: 4 }),
    fc.boolean(),
    fc.integer({ min: 0, max: 2 }),
    valueArb,
  )
  .map(([kinds, keyLink, embed, other]) => {
    const nodes = kinds.map((k) => makers[k]!.make());
    nodes.forEach((n, i) => makers[kinds[i]!]!.link(n, nodes[(i + 1) % nodes.length], keyLink));
    const ring = nodes[0];
    if (embed === 1) return [other, ring];
    if (embed === 2) return { other, ring };
    return ring;
  });

/** Values with several paths to the same object and no path back to an ancestor. */
export const sharedValueArb: fc.Arbitrary<unknown> = fc
  .tuple(valueArb, fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 3 }))
  .map(([base, shapes]) => {
    let cur: unknown = base;
    for (const s of shapes) {
      const c = cur;
      if (s === 0) cur = [c, c];
      else if (s === 1) cur = { l: c, r: c };
      else if (s === 2)
        cur = new Map<unknown, unknown>([
          ["a", c],
          ["b", c],
        ]);
      else cur = [c, [c]];
    }
    return cur;
  });
