import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";

type RuntimeSocket = {
  opened: Promise<unknown>;
  closed: Promise<unknown>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<unknown>;
  startTls(options: { expectedServerHostname: string }): RuntimeSocket;
};
type Connect = (
  address: { hostname: string; port: number },
  options: { secureTransport: "starttls" | "off" },
) => RuntimeSocket;
type Target = { host: string[]; port: number[] };
const failure = (code: string, message: string) =>
  Object.assign(new Error(message), { code });
const closedError = () =>
  failure(
    "CONNECTION_CLOSED",
    "Database socket closed before the operation completed",
  );

// postgres's socket hook receives an already-connected transport. TLS is owned
// here, so the caller must pass ssl:false to postgres after selecting this hook.
// In particular, closing the replaced plaintext socket during startTls must not
// be reported as a disconnect of the current encrypted transport.
export function createCloudflareSocketFactory(
  secure: boolean,
  settings: { connectTimeoutMs?: number; connect?: Connect } = {},
) {
  let attempts = 0;
  return async (target: Target) => {
    if (++attempts > 2)
      throw failure(
        "DB_CONNECTION_RETRY_LIMIT",
        "Database connection attempt budget exhausted",
      );
    const host = target.host[0],
      port = Number(target.port[0]);
    let current: RuntimeSocket | undefined;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkDeadline = () => {
      if (!expired) return;
      void current?.close().catch(() => undefined);
      throw failure("CONNECT_TIMEOUT", "Database connection deadline exceeded");
    };
    try {
      return await Promise.race([
        (async () => {
          const connect =
            settings.connect ??
            (
              (await import("cloudflare:sockets" as string)) as {
                connect: Connect;
              }
            ).connect;
          checkDeadline();
          current = connect(
            { hostname: host, port },
            { secureTransport: secure ? "starttls" : "off" },
          );
          current.closed.catch(() => undefined);
          await current.opened;
          checkDeadline();
          if (secure) {
            const plaintext = current;
            const writer = plaintext.writable.getWriter();
            const reader = plaintext.readable.getReader();
            try {
              await writer.write(new Uint8Array([0, 0, 0, 8, 4, 210, 22, 47]));
              const reply = await reader.read();
              if (
                reply.done ||
                reply.value.length !== 1 ||
                reply.value[0] !== 83
              )
                throw failure(
                  "DB_TLS_FAILED",
                  "Database did not accept required TLS negotiation",
                );
            } finally {
              writer.releaseLock();
              reader.releaseLock();
            }
            checkDeadline();
            current = plaintext.startTls({ expectedServerHostname: host });
            current.closed.catch(() => undefined);
            await current.opened;
            checkDeadline();
          }
          return new CloudflareDatabaseSocket(current, host, port);
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(
              failure(
                "CONNECT_TIMEOUT",
                "Database connection deadline exceeded",
              ),
            );
          }, settings.connectTimeoutMs ?? 10000);
        }),
      ]);
    } catch (error) {
      void current?.close().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

class CloudflareDatabaseSocket extends EventEmitter {
  readyState = "open";
  destroyed = false;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writes: Promise<void> = Promise.resolve();
  private closing = false;
  private finished = false;
  private pendingError?: unknown;
  constructor(
    private readonly raw: RuntimeSocket,
    readonly host: string,
    readonly port: number,
  ) {
    super();
    this.writer = raw.writable.getWriter();
    this.on("newListener", (event: string) => {
      if (event === "data") queueMicrotask(() => this.read());
      if (event === "error") queueMicrotask(() => this.deliverFailure());
    });
    raw.closed.then(
      () => this.finish(this.closing ? undefined : closedError()),
      (error) => this.finish(error),
    );
  }
  private deliverFailure() {
    if (this.pendingError && this.listenerCount("error")) {
      const error = this.pendingError;
      this.pendingError = undefined;
      this.emit("error", error);
      this.emit("close", true);
    }
  }
  private finish(error?: unknown) {
    if (this.finished) return;
    this.finished = true;
    this.readyState = "closed";
    if (error) {
      void this.raw.close().catch(() => undefined);
      this.pendingError = error;
      this.deliverFailure();
    } else this.emit("close", false);
  }
  private async read() {
    if (this.reader || this.finished) return;
    this.reader = this.raw.readable.getReader();
    try {
      while (!this.finished) {
        const next = await this.reader.read();
        if (next.done) {
          this.finish(this.closing ? undefined : closedError());
          break;
        }
        this.emit("data", Buffer.from(next.value));
      }
    } catch (error) {
      this.finish(error);
    } finally {
      this.reader.releaseLock();
    }
  }
  write(data: Uint8Array | string, callback?: () => void) {
    if (this.finished || this.closing) return false;
    const bytes =
      typeof data === "string" ? Buffer.from(data) : new Uint8Array(data);
    this.writes = this.writes
      .then(() => this.writer.write(bytes))
      .then(() => {
        callback?.();
      })
      .catch((error) => {
        this.finish(error);
      });
    return true;
  }
  end(data?: Uint8Array) {
    if (this.closing) return;
    if (data?.length) this.write(data);
    this.closing = true;
    this.readyState = "closing";
    void this.writes
      .then(() => {
        this.writer.releaseLock();
        return this.raw.close();
      })
      .catch((error) => this.finish(error));
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closing = true;
    void this.raw.close().catch((error) => this.finish(error));
    this.finish();
  }
}
