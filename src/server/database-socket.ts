import { Socket } from "node:net";

type Target = { host: string[]; port: number[] };
type ConnectedSocket = Socket & { host: string; port: number };
type Settings = {
  connectTimeoutMs?: number;
  createSocket?: () => Socket;
};
function failure(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

// Web requests own this factory; never share its attempt budget across requests.
// postgres.js retries a graceful close before StartupMessage without advancing
// its backoff or retaining its connect timer. Cap transport attempts here.
export function createRequestSocketFactory(settings: Settings = {}) {
  let attempts = 0;
  const timeoutMs = settings.connectTimeoutMs ?? 10000;
  return (target: Target): Promise<ConnectedSocket> => {
    if (++attempts > 2)
      return Promise.reject(
        failure(
          "DB_CONNECTION_RETRY_LIMIT",
          "Database transport closed repeatedly during connection startup",
        ),
      );
    const host = target.host?.[0],
      port = target.port?.[0];
    if (
      !host ||
      host.includes("\0") ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      return Promise.reject(
        failure(
          "DB_CONNECTION_TARGET_INVALID",
          "Invalid database transport target",
        ),
      );
    return new Promise((resolve, reject) => {
      const socket = (settings.createSocket?.() ??
        new Socket()) as ConnectedSocket;
      socket.host = host;
      socket.port = port;
      let settled = false;
      const timer = setTimeout(
        () =>
          rejectAndClose(
            failure("CONNECT_TIMEOUT", "Database transport connect timeout"),
          ),
        timeoutMs,
      );
      function detach() {
        clearTimeout(timer);
        socket.removeListener("connect", connected);
        socket.removeListener("error", rejected);
        socket.removeListener("close", closed);
      }
      function rejectAndClose(error: Error) {
        if (settled) return;
        settled = true;
        detach();
        // An OS error can arrive after a timed-out pending connect is destroyed.
        // Consume that final error until close, then release the temporary guard.
        const ignore = () => {};
        socket.once("error", ignore);
        socket.once("close", () => socket.removeListener("error", ignore));
        socket.destroy();
        reject(error);
      }
      function rejected(error: Error) {
        rejectAndClose(error);
      }
      function closed() {
        rejectAndClose(
          failure(
            "CONNECTION_CLOSED",
            "Database transport closed before connect",
          ),
        );
      }
      function connected() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener("connect", connected);
        socket.removeListener("close", closed);
        // Keep the early error guard until the await continuation has attached
        // the driver's listeners; the next microtask then releases ownership.
        resolve(socket);
        queueMicrotask(() => socket.removeListener("error", rejected));
      }
      socket.once("connect", connected);
      socket.once("error", rejected);
      socket.once("close", closed);
      try {
        socket.connect({ host, port });
      } catch (error) {
        rejectAndClose(
          error instanceof Error
            ? error
            : new Error("Database transport connect failed"),
        );
      }
    });
  };
}
