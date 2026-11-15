// Network denial under the real Sandbox_Executor (task 18.2; Requirements 5, 15.6).
// A package function that tries to reach a local server the test started must fail, and the server
// must never see a connection: the denial comes from the Node permission model before a socket opens.
// Requirements: 5.2, 15.6
import { createServer } from "node:http";
import type { Server, Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { readChildPermissions, withExecutor } from "./helpers/sandboxHarness";

interface Probe {
  ok: boolean;
  code: string | null;
}

interface Listener {
  server: Server;
  port: number;
  connections: () => number;
  close: () => Promise<void>;
}

async function listen(): Promise<Listener> {
  let count = 0;
  const sockets = new Set<Socket>();
  const server = createServer((_req, res) => res.end("hi"));
  server.on("connection", (socket) => {
    count++;
    sockets.add(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    connections: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

describe("network denied in the sandbox", () => {
  it("a connect, a fetch and a lookup fail and the local server sees no connection", async () => {
    const listener = await listen();
    try {
      await withExecutor("net-probe", async (ctx) => {
        const connect = (await ctx.side.callValue("connect", ["127.0.0.1", listener.port])) as Probe;
        const connectName = (await ctx.side.callValue("connect", ["localhost", listener.port])) as Probe;
        const fetched = (await ctx.side.callValue("fetchUrl", [`http://127.0.0.1:${listener.port}/`])) as Probe;
        const lookedUp = (await ctx.side.callValue("lookup", ["example.invalid"])) as Probe;
        const lookedUpLocal = (await ctx.side.callValue("lookup", ["localhost"])) as Probe;

        // Observed under the permission model: every attempt fails with ERR_ACCESS_DENIED
        // (net.connect, the fetch connection cause, and dns.lookup), before any socket is opened.
        for (const r of [connect, connectName, fetched, lookedUp, lookedUpLocal]) {
          expect(r).toEqual({ ok: false, code: "ERR_ACCESS_DENIED" });
        }
      });
      expect(listener.connections()).toBe(0);
    } finally {
      await listener.close();
    }
  });

  it("the child reports the permission model on and no net permission", async () => {
    await withExecutor("env-probe", async (ctx) => {
      const perms = await readChildPermissions(ctx.side);
      expect(perms.enabled).toBe(true);
      expect(perms.net).toBe(false);
    });
  });
});
