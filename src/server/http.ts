export class AppRequest extends Request {
  get nextUrl() {
    return new URL(this.url);
  }
  get cookies() {
    const header = this.headers.get("cookie") ?? "";
    return {
      get(name: string) {
        const value = header
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(name + "="));
        if (!value) return undefined;
        try {
          return { value: decodeURIComponent(value.slice(name.length + 1)) };
        } catch {
          return undefined;
        }
      },
    };
  }
}
type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax";
  path?: string;
  maxAge?: number;
};
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
) {
  return `${name}=${encodeURIComponent(value)}; Path=${options.path ?? "/"}${options.httpOnly ? "; HttpOnly" : ""}${options.secure ? "; Secure" : ""}${options.sameSite ? "; SameSite=" + options.sameSite : ""}${options.maxAge === undefined ? "" : "; Max-Age=" + options.maxAge}`;
}
export class AppResponse extends Response {
  static json(data: unknown, options?: ResponseInit) {
    const headers = new Headers(options?.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new AppResponse(JSON.stringify(data), { ...options, headers });
  }
  get cookies() {
    return {
      set: (name: string, value: string, options?: CookieOptions) =>
        this.headers.append(
          "Set-Cookie",
          serializeCookie(name, value, options),
        ),
    };
  }
}
