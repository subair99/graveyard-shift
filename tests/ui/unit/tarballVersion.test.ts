// Requirements: 2.9, 2.10
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { packTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { readResurrectionVersion } from "../../../src/ui/shell/tarballVersion";

const enc = new TextEncoder();

function pack(files: Record<string, string>): Uint8Array {
  const r = packTarball(Object.entries(files).map(([path, text]) => ({ path, bytes: enc.encode(text) })));
  if (!r.ok) throw new Error("pack failed");
  return r.value;
}

function leftovers(): string[] {
  return readdirSync(tmpdir()).filter((n) => n.startsWith("crypt-tgz-"));
}

describe("readResurrectionVersion", () => {
  it("returns the valid semver version of package.json", async () => {
    const r = await readResurrectionVersion(pack({ "package.json": '{"version":"1.2.3"}' }));
    expect(r).toEqual({ ok: true, value: "1.2.3" });
  });

  it("returns an error for a non-semver version", async () => {
    const r = await readResurrectionVersion(pack({ "package.json": '{"version":"v1.2"}' }));
    expect(r.ok).toBe(false);
  });

  it("returns an error when package.json is missing", async () => {
    const r = await readResurrectionVersion(pack({ "index.js": "x" }));
    expect(r.ok).toBe(false);
  });

  it("returns an error for bytes that are not an archive", async () => {
    const r = await readResurrectionVersion(enc.encode("not a tarball"));
    expect(r.ok).toBe(false);
  });

  it("removes its temporary directory", async () => {
    const before = leftovers().length;
    await readResurrectionVersion(pack({ "package.json": '{"version":"1.0.0"}' }));
    await readResurrectionVersion(enc.encode("garbage"));
    expect(leftovers().length).toBe(before);
  });
});
