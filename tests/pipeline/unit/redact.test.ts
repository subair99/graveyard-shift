// Requirements: 7.10, 22.1
import { describe, expect, it } from "vitest";
import {
  hasCredentialOrPath,
  redactionScanFindsAnything,
  redactText,
} from "../../../src/pipeline/common/canonical";

const identity = {
  pathValues: ["C:\\Users\\Zelda Quux"],
  userName: "zeldaquux",
};

describe("redactText", () => {
  it("redacts identity values", () => {
    const out = redactText("home C:\\Users\\Zelda Quux\\x and zeldaquux", identity, "win32");
    expect(out).not.toMatch(/Zelda|zeldaquux/i);
    expect(out).toContain("<user-home>");
    expect(out).toContain("<user>");
  });

  it("redacts credential shapes", () => {
    const text = [
      "token ghp_abcDEF1234567890abcDEF1234567890abcd",
      "pat github_pat_11AAAA_bbbbCCCC",
      "Bearer abc.def-123",
      "Authorization: token xyz",
    ].join("\n");
    const out = redactText(text, { pathValues: [], userName: undefined }, "posix");
    expect(out).not.toMatch(/ghp_|github_pat_|Bearer|Authorization|xyz|abc\.def/);
    expect(hasCredentialOrPath(out)).toBe(false);
  });

  it("redacts absolute paths", () => {
    const empty = { pathValues: [], userName: undefined };
    for (const p of ["D:\\work\\a.txt", "/home/bob/x", "/Users/bob/x", "/mnt/c/dev/x"]) {
      const out = redactText(`see ${p} now`, empty, "posix");
      expect(out).toBe("see <path> now");
    }
  });

  it("keeps relative paths and plain text", () => {
    const empty = { pathValues: [], userName: undefined };
    const text = "resurrection/package.json and graveyard/ip/eligibility.json";
    expect(redactText(text, empty, "posix")).toBe(text);
    expect(redactionScanFindsAnything(text, empty, "posix")).toBe(false);
  });

  it("is idempotent", () => {
    const text = "C:\\Users\\Zelda Quux\\a ghp_abc123 /home/x/y Bearer t";
    const once = redactText(text, identity, "win32");
    expect(redactText(once, identity, "win32")).toBe(once);
    expect(redactionScanFindsAnything(once, identity, "win32")).toBe(false);
  });
});
