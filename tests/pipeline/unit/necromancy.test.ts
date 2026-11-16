// Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.9, 22.10

import { describe, expect, it } from "vitest";
import { checkNecromancy, isLicenseFileName, type NecromancyInput } from "../../../src/pipeline/necromancy/core/gate";
import { collectAuthorCredits } from "../../../src/pipeline/necromancy/core/authors";

const text = (s: string) => new TextEncoder().encode(s);

function base(): NecromancyInput {
  return {
    original: {
      name: "ip",
      version: "2.0.1",
      license: "MIT",
      author: "Fedor Indutny <fedor@indutny.com> (https://x.example)",
      contributors: [{ name: "Bob", email: "BOB@x.io" }],
    },
    resurrection: {
      name: "@graveyard-shift/ip",
      version: "2.0.2",
      license: "MIT",
      author: { name: "fedor indutny", email: "fedor@indutny.com", url: "https://x.example" },
      contributors: ["Bob <bob@x.io>", "Me"],
    },
    originalLicense: { path: "LICENSE", bytes: text("MIT text") },
    resurrectionLicense: { path: "LICENSE", bytes: text("MIT text") },
  };
}

function failed(input: NecromancyInput): string[] {
  return checkNecromancy(input).checks.filter((c) => !c.ok).map((c) => c.id);
}

describe("checkNecromancy", () => {
  it("accepts a lawful resurrection and reports all six checks", () => {
    const r = checkNecromancy(base());
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual([
      "license", "license-file", "author-credits", "version", "name", "forbidden-fields",
    ]);
  });

  it("rejects a changed license", () => {
    const i = base();
    expect(failed({ ...i, resurrection: { ...i.resurrection, license: "GPL-3.0" } })).toEqual(["license"]);
  });

  it("checks the license file: missing, different, and absent in the original", () => {
    const i = base();
    expect(failed({ ...i, resurrectionLicense: null })).toEqual(["license-file"]);
    expect(failed({ ...i, resurrectionLicense: { path: "LICENSE", bytes: text("MIT text\n") } })).toEqual(["license-file"]);
    expect(failed({ ...i, originalLicense: null, resurrectionLicense: null })).toEqual([]);
  });

  it("recognizes license file names", () => {
    for (const n of ["LICENSE", "licence", "License.md", "LICENSE.txt"]) expect(isLicenseFileName(n)).toBe(true);
    for (const n of ["LICENSES", "my-license", "license-mit.txt", "src"]) expect(isLicenseFileName(n)).toBe(false);
  });

  it("requires every author credit, in string or object form", () => {
    const i = base();
    expect(failed({ ...i, resurrection: { ...i.resurrection, contributors: [] } })).toEqual(["author-credits"]);
    expect(collectAuthorCredits({ author: "A <a@x> (u)" })).toEqual([{ name: "a", email: "a@x", url: "u" }]);
  });

  it("accepts patch and minor increases only", () => {
    const i = base();
    const v = (version: string) => failed({ ...i, resurrection: { ...i.resurrection, version } });
    expect(v("2.1.0")).toEqual([]);
    expect(v("2.0.1")).toEqual(["version"]);
    expect(v("2.0.0")).toEqual(["version"]);
    expect(v("3.0.0")).toEqual(["version"]);
    expect(v("2.0.2-beta.1")).toEqual(["version"]);
    expect(v("nope")).toEqual(["version"]);
  });

  it("requires the scoped name", () => {
    const i = base();
    expect(failed({ ...i, resurrection: { ...i.resurrection, name: "ip" } })).toEqual(["name"]);
    expect(failed({ ...i, resurrection: { ...i.resurrection, name: "@other/ip" } })).toEqual(["name"]);
  });

  it("rejects forbidden fields", () => {
    const i = base();
    const r = (extra: Record<string, unknown>) => failed({ ...i, resurrection: { ...i.resurrection, ...extra } });
    expect(r({ dependencies: { left: "1.0.0" } })).toEqual(["forbidden-fields"]);
    expect(r({ scripts: { postinstall: "x" } })).toEqual(["forbidden-fields"]);
    expect(r({ scripts: { prepare: "x" } })).toEqual(["forbidden-fields"]);
    expect(r({ bin: "cli.js" })).toEqual(["forbidden-fields"]);
    expect(r({ type: "module" })).toEqual(["forbidden-fields"]);
    expect(r({ type: "commonjs", scripts: { test: "x" } })).toEqual([]);
  });

  it("allows dependencies the original already had", () => {
    const i = base();
    const withDep = {
      ...i,
      original: { ...i.original, dependencies: { a: "1" } },
      resurrection: { ...i.resurrection, dependencies: { a: "1.0.1" } },
    };
    expect(failed(withDep)).toEqual([]);
  });

  it("lists every failure at once", () => {
    const i = base();
    const r = checkNecromancy({
      ...i,
      resurrection: { name: "ip", version: "3.0.0", license: "GPL", bin: "x" },
      resurrectionLicense: null,
    });
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok)).toHaveLength(6);
  });
});
