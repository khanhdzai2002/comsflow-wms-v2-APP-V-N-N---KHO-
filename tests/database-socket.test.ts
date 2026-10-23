import { afterEach, expect, it, vi } from "vitest";
import { createServer, Socket } from "node:net";
import postgres from "postgres";
import { createRequestSocketFactory } from "../src/server/database-socket";

afterEach(() => vi.useRealTimers());
it("bounds actual postgres startup retries after graceful peer closes", async () => {
  let accepted = 0;
  const peers = new Set<Socket>();
  const server = createServer((socket) => {
    accepted++;
    peers.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => peers.delete(socket));
    socket.once("data", () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("test server address missing");
  const socketFactory = createRequestSocketFactory({ connectTimeoutMs: 500 });
  // The upstream JS supports custom sockets but omits this hook in its typings.
  const options = {
    max: 1,
    prepare: false,
    ssl: false,
    connect_timeout: 1,
    socket: socketFactory,
  };
  const sql = postgres(
    `postgres://fixture:dummy@127.0.0.1:${address.port}/fixture_test`,
    options,
  );
  const started = performance.now();
  try {
    await expect(sql`SELECT 1`).rejects.toMatchObject({
      code: "DB_CONNECTION_RETRY_LIMIT",
    });
    expect(accepted).toBe(2);
    expect(performance.now() - started).toBeLessThan(2000);
  } finally {
    await sql.end({ timeout: 0 });
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("times out and destroys a pending connect, safely handling its late error", async () => {
  vi.useFakeTimers();
  class PendingSocket extends Socket {
    destroy(error?: Error) {
      queueMicrotask(() => {
        this.emit("error", error ?? new Error("late pending connect error"));
        this.emit("close");
      });
      return this;
    }
  }
  const socket = new PendingSocket();
  vi.spyOn(socket, "connect").mockReturnValue(socket);
  const destroy = vi.spyOn(socket, "destroy");
  const factory = createRequestSocketFactory({
    connectTimeoutMs: 10,
    createSocket: () => socket,
  });
  const pending = factory({ host: ["unused.test"], port: [6543] });
  const rejected = expect(pending).rejects.toMatchObject({
    code: "CONNECT_TIMEOUT",
  });
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(destroy).toHaveBeenCalledOnce();
  expect(socket.listenerCount("connect")).toBe(0);
  expect(socket.listenerCount("error")).toBe(0);
});
it("preserves connection errors and never opens an invalid target", async () => {
  const factory = createRequestSocketFactory({
    createSocket: () => {
      throw Object.assign(new Error("fixture refused"), {
        code: "ECONNREFUSED",
      });
    },
  });
  await expect(
    factory({ host: ["unused.test"], port: [6543] }),
  ).rejects.toMatchObject({ code: "ECONNREFUSED" });
  const create = vi.fn(() => new Socket());
  await expect(
    createRequestSocketFactory({ createSocket: create })({
      host: ["unused.test"],
      port: [0],
    }),
  ).rejects.toMatchObject({ code: "DB_CONNECTION_TARGET_INVALID" });
  expect(create).not.toHaveBeenCalled();
});
it("sets TLS servername metadata and releases connect timeout after success", async () => {
  const server = createServer((socket) => socket.on("error", () => {}));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("test server address missing");
  const factory = createRequestSocketFactory({ connectTimeoutMs: 20 });
  const socket = await factory({ host: ["127.0.0.1"], port: [address.port] });
  socket.on("error", () => {});
  expect(socket.host).toBe("127.0.0.1");
  expect(socket.port).toBe(address.port);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(socket.destroyed).toBe(false);
  socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
