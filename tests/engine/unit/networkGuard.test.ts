import { describe, expect, it } from "vitest";
import http from "node:http";
import { NetworkGuardError, isLlmHost } from "../../setup/networkGuard";

describe("network guard", () => {
  it("blocks a real global fetch call", async () => {
    await expect(fetch("https://registry.npmjs.org/ip")).rejects.toBeInstanceOf(NetworkGuardError);
  });

  it("names LLM hosts in the error", async () => {
    await expect(fetch("https://api.openai.com/v1/chat/completions")).rejects.toThrow(/LLM service/);
    expect(isLlmHost("https://api.anthropic.com/v1/messages")).toBe(true);
    expect(isLlmHost("https://registry.npmjs.org/ip")).toBe(false);
  });

  it("blocks node:http requests", () => {
    expect(() => http.request("http://example.com/")).toThrow(NetworkGuardError);
  });

  it("lets a test use its own injected fetch", async () => {
    const injected = async () => new Response('{"ok":true}', { status: 200 });
    const res = await injected();
    expect(await res.json()).toEqual({ ok: true });
  });
});
