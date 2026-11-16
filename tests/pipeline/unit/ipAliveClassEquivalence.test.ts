// Requirements: 23.23, 23.24; resurrection-pipeline 4.17
// Feature: resurrection-pipeline, Property: ip-alive differs from the Original only inside the class
//
// ip-alive (tests/proof/fixtures/ip-alive/lib/ip.js) answers isPublic(x) = inNonPublicAddressClass(x) ? false
// : Original's isPublic(x). Its class function is a plain-JS copy of isNonPublicAddress
// (src/pipeline/harness/core/presets/ipNonPublicAddress.ts). This test checks, on explicit inputs and on
// generated strings:
//   (a) the copy equals isNonPublicAddress (read directly: the class block is evaluated in a vm), and so
//       ip-alive's isPublic is false inside the class and equals the Original's outside it;
//   (b) wherever the two isPublic functions differ, the input is in the class.
// "Answers" means the outcome: the returned value, or the message of the thrown error. Both libraries
// are pure, so they are loaded in the test process (the Original from the recorded tarball, extracted to
// a temp dir).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  IP_ADDRESS_PRESET,
  ipString,
  malformedV6String,
} from "../../../src/pipeline/harness/core/presets/ipAddress";
import { isNonPublicAddress } from "../../../src/pipeline/harness/core/presets/ipNonPublicAddress";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";

const TARBALL = resolve(__dirname, "../../proof/fixtures/ip/ip-2.0.1.tgz");
const ALIVE_FILE = resolve(__dirname, "../../proof/fixtures/ip-alive/lib/ip.js");

type Outcome = { readonly threw: false; readonly value: unknown } | { readonly threw: true; readonly message: string };
interface IpLib {
  isPublic(addr: unknown): unknown;
}

let originalDir = "";
let original: IpLib;
let alive: IpLib;
let fixtureClass: (input: unknown) => boolean;

function outcome(lib: IpLib, input: string): Outcome {
  try {
    return { threw: false, value: lib.isPublic(input) };
  } catch (error) {
    return { threw: true, message: error instanceof Error ? error.message : String(error) };
  }
}

/** The IIFE `var inNonPublicAddressClass = (function () {...}());` of the fixture, evaluated alone. */
function loadFixtureClass(source: string): (input: unknown) => boolean {
  const start = source.indexOf("var inNonPublicAddressClass = (function () {");
  const endMarker = "\n}());";
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("the class block of the ip-alive fixture was not found");
  const block = source.slice(start, end + endMarker.length);
  return runInNewContext(`${block}\ninNonPublicAddressClass;`) as (input: unknown) => boolean;
}

beforeAll(async () => {
  originalDir = mkdtempSync(join(tmpdir(), "gs-ip-alive-class-"));
  const extracted = await extractTarball(new Uint8Array(readFileSync(TARBALL)), originalDir);
  if (!extracted.ok) throw new Error(`extract failed: ${extracted.error.kind}`);
  const load = createRequire(import.meta.url);
  original = load(join(originalDir, "lib", "ip.js")) as IpLib;
  alive = load(ALIVE_FILE) as IpLib;
  fixtureClass = loadFixtureClass(readFileSync(ALIVE_FILE, "utf8"));
});

afterAll(() => {
  if (originalDir !== "") rmSync(originalDir, { recursive: true, force: true });
});

/** Checks (a) and (b) for one input; returns whether the input is in the class. */
function checkInput(input: string): boolean {
  const inClass = isNonPublicAddress(input);
  expect(fixtureClass(input), `class of ${JSON.stringify(input)}`).toBe(inClass);
  const a = outcome(alive, input);
  const o = outcome(original, input);
  if (inClass) expect(a, `alive on ${JSON.stringify(input)}`).toEqual({ threw: false, value: false });
  else expect(a, `alive outside the class on ${JSON.stringify(input)}`).toEqual(o);
  // (b): a difference implies the class
  if (JSON.stringify(a) !== JSON.stringify(o)) expect(inClass, `difference on ${JSON.stringify(input)}`).toBe(true);
  return inClass;
}

const rawChars = fc
  .array(fc.constantFrom("0", "1", "7", "9", "a", "f", "x", ":", ":", ".", ".", "%"), { maxLength: 30 })
  .map((chars) => chars.join(""));

describe("ip-alive differs from the Original only inside the class", () => {
  it("exposes the class block and the Original from the tarball", () => {
    expect(typeof fixtureClass).toBe("function");
    expect(outcome(original, "10.0.0.1")).toEqual({ threw: false, value: false });
    expect(fixtureClass("0x7f.1")).toBe(true);
    expect(fixtureClass("8.8.8.8")).toBe(false);
  });

  it("holds on every explicit isPublic case of the preset", () => {
    const cases = IP_ADDRESS_PRESET.build({}, "isPublic").explicitCases ?? [];
    expect(cases.length).toBeGreaterThan(30);
    const inputs = cases.map((c) => c[0]).filter((a): a is string => typeof a === "string");
    expect(inputs).toEqual(expect.arrayContaining([":::", "::", "::::", ":", "::0", "0::", ":::1", "0x7f.1", "172.16.0.0x1"]));
    let inside = 0;
    let outside = 0;
    for (const input of inputs) (checkInput(input) ? inside++ : outside++);
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
  });

  it("the malformed colon runs are outside the class and answered as the Original answers", () => {
    for (const input of [":::", "::::", ":", ":::1"]) {
      expect(isNonPublicAddress(input)).toBe(false);
      expect(outcome(alive, input)).toEqual(outcome(original, input));
    }
  });

  it("'::0' and '0::' parse to the unspecified address, so they are in the class", () => {
    for (const input of ["::", "::0", "0::"]) {
      expect(isNonPublicAddress(input)).toBe(true);
      expect(outcome(alive, input)).toEqual({ threw: false, value: false });
    }
  });

  it("property: equal outside the class, false inside it, differences only inside it", () => {
    fc.assert(
      fc.property(fc.oneof(ipString, malformedV6String, rawChars), (input) => {
        checkInput(input);
      }),
      { numRuns: 500 },
    );
  });
});
