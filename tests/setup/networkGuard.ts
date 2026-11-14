import http from "node:http";
import https from "node:https";

/**
 * Network guard (Requirements 10.1, 11.4).
 * Unit, property and fixture tests must use an injected fetch. Any real outbound
 * request through the global fetch or node:http(s) fails the run with a clear error.
 */

export const LLM_HOST_DENYLIST: readonly string[] = [
  "api.openai.com",
  "openai.com",
  "api.anthropic.com",
  "anthropic.com",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
  "api.cohere.com",
  "api.cohere.ai",
  "api.groq.com",
  "api.together.xyz",
  "api.perplexity.ai",
  "api.x.ai",
  "api.deepseek.com",
  "openrouter.ai",
  "api.fireworks.ai",
  "huggingface.co",
  "amazonaws.com/bedrock",
  "bedrock-runtime.amazonaws.com",
  "openai.azure.com",
];

export class NetworkGuardError extends Error {
  constructor(target: string, llm: boolean) {
    super(
      llm
        ? `Network guard: request to LLM service blocked (${target}). The engine makes no LLM calls.`
        : `Network guard: real network request blocked (${target}). Inject a fetch in the test instead.`,
    );
    this.name = "NetworkGuardError";
  }
}

export function isLlmHost(hostOrUrl: string): boolean {
  let host = hostOrUrl;
  try {
    host = new URL(hostOrUrl).hostname;
  } catch {
    // not a URL: treat as a bare host
  }
  host = host.toLowerCase();
  return LLM_HOST_DENYLIST.some((d) => {
    const bare = d.split("/")[0] ?? d;
    return host === bare || host.endsWith("." + bare);
  });
}

function describeTarget(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  if (typeof input === "object" && input !== null) {
    const o = input as { hostname?: unknown; host?: unknown; path?: unknown };
    return `${String(o.hostname ?? o.host ?? "unknown host")}${String(o.path ?? "")}`;
  }
  return String(input);
}

const guardedFetch = (async (input: unknown) => {
  const target = describeTarget(input);
  throw new NetworkGuardError(target, isLlmHost(target));
}) as unknown as typeof fetch;

function guardedRequest(...args: unknown[]): never {
  const target = describeTarget(args[0]);
  throw new NetworkGuardError(target, isLlmHost(target));
}

export function installNetworkGuard(): void {
  globalThis.fetch = guardedFetch;
  for (const mod of [http, https] as unknown as Record<string, unknown>[]) {
    mod.request = guardedRequest;
    mod.get = guardedRequest;
  }
}

installNetworkGuard();
