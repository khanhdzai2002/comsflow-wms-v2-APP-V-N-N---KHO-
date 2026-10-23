import { expect, it, vi } from "vitest";
import { createCloudflareSocketFactory } from "../src/server/cloudflare-database-socket";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function raw() {
  const done = deferred<void>();
  let incoming!: ReadableStreamDefaultController<Uint8Array>;
  const writes: Uint8Array[] = [];
  const result = {
    opened: Promise.resolve(),
    closed: done.promise,
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        incoming = controller;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        writes.push(bytes);
      },
    }),
    close: vi.fn(async () => {
      done.resolve();
    }),
    startTls: vi.fn(),
  };
  return {
    result,
    done,
    writes,
    get incoming() {
      return incoming;
    },
  };
}
const target = { host: ["example.test"], port: [6543] };
it("TLS upgrade ignores closure of replaced plaintext and preserves initial data", async () => {
  const plain = raw(),
    encrypted = raw(),
    gate = deferred<void>();
  encrypted.result.opened = gate.promise;
  plain.result.startTls.mockImplementation(() => {
    plain.done.resolve();
    return encrypted.result;
  });
  plain.incoming.enqueue(new Uint8Array([83]));
  const factory = createCloudflareSocketFactory(true, {
    connect: () => plain.result,
  });
  const pending = factory(target);
  await vi.waitFor(() =>
    expect(plain.result.startTls).toHaveBeenCalledWith({
      expectedServerHostname: "example.test",
    }),
  );
  gate.resolve();
  const socket = await pending;
  const errors: unknown[] = [];
  socket.on("error", (e) => errors.push(e));
  const received = deferred<Buffer>();
  socket.on("data", (chunk) => received.resolve(chunk));
  encrypted.incoming.enqueue(new Uint8Array([82, 0, 0, 0, 8]));
  expect(Array.from(await received.promise)).toEqual([82, 0, 0, 0, 8]);
  expect(socket.readyState).toBe("open");
  expect(errors).toEqual([]);
  expect(Array.from(plain.writes[0])).toEqual([0, 0, 0, 8, 4, 210, 22, 47]);
  socket.destroy();
  await vi.waitFor(() => expect(encrypted.result.close).toHaveBeenCalled());
});
it("limits a request to two connection attempts", async () => {
  const connect = vi.fn(() => raw().result);
  const factory = createCloudflareSocketFactory(false, { connect });
  const first = await factory(target),
    second = await factory(target);
  await expect(factory(target)).rejects.toMatchObject({
    code: "DB_CONNECTION_RETRY_LIMIT",
  });
  expect(connect).toHaveBeenCalledTimes(2);
  first.destroy();
  second.destroy();
});
it("rejects missing TLS support without plaintext fallback", async () => {
  const plain = raw();
  plain.incoming.enqueue(new Uint8Array([78]));
  const factory = createCloudflareSocketFactory(true, {
    connect: () => plain.result,
  });
  await expect(factory(target)).rejects.toMatchObject({
    code: "DB_TLS_FAILED",
  });
  expect(plain.result.startTls).not.toHaveBeenCalled();
  expect(plain.result.close).toHaveBeenCalled();
});
it("applies a deadline to stalled TLS and closes transport", async () => {
  const plain = raw();
  const factory = createCloudflareSocketFactory(true, {
    connect: () => plain.result,
    connectTimeoutMs: 10,
  });
  await expect(factory(target)).rejects.toMatchObject({
    code: "CONNECT_TIMEOUT",
  });
  expect(plain.result.close).toHaveBeenCalled();
  // Let the pending read settle, as a closed runtime stream would do.
  plain.incoming.close();
});
it("delivers early peer failure after driver attaches error handler", async () => {
  const peer = raw();
  const factory = createCloudflareSocketFactory(false, {
    connect: () => peer.result,
  });
  const socket = await factory(target);
  peer.done.resolve();
  await Promise.resolve();
  const failed = deferred<unknown>();
  socket.on("error", (e) => failed.resolve(e));
  await expect(failed.promise).resolves.toMatchObject({
    code: "CONNECTION_CLOSED",
  });
});
it("flushes final writes before closing", async () => {
  const peer = raw();
  const factory = createCloudflareSocketFactory(false, {
    connect: () => peer.result,
  });
  const socket = await factory(target);
  socket.write(new Uint8Array([1]));
  socket.end(new Uint8Array([2]));
  await vi.waitFor(() => expect(peer.result.close).toHaveBeenCalled());
  expect(peer.writes.map((x) => Array.from(x))).toEqual([[1], [2]]);
});

it("does not begin TLS after the TCP deadline has expired", async () => {
  const peer = raw(),
    gate = deferred<void>();
  peer.result.opened = gate.promise;
  const factory = createCloudflareSocketFactory(true, {
    connect: () => peer.result,
    connectTimeoutMs: 10,
  });
  await expect(factory(target)).rejects.toMatchObject({
    code: "CONNECT_TIMEOUT",
  });
  gate.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(peer.writes).toEqual([]);
  expect(peer.result.startTls).not.toHaveBeenCalled();
});
