import type { AppEnv } from "./context";

// SERVER ONLY. This is for private Worker logs, never API responses or browser
// bundles. Return only bounded, redacted message text: no stack, query, SQL,
// parameters, arbitrary exception properties or serialized provider objects.
const REDACTED = "[redacted]";
const LIMIT = 500;

function property(value: unknown, name: string): unknown {
  if (!value || (typeof value !== "object" && typeof value !== "function"))
    return undefined;
  try {
    return Reflect.get(value, name);
  } catch {
    return undefined;
  }
}
function stringProperty(value: unknown, name: string): string | undefined {
  const result = property(value, name);
  return typeof result === "string" ? result : undefined;
}
function secretValues(env: Partial<AppEnv>) {
  const values = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value) return;
    values.add(value);
    const trimmed = value.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (trimmed) values.add(trimmed);
  };
  for (const name of [
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "SETUP_TOKEN",
  ])
    add(property(env, name));
  const hyperdrive = stringProperty(
    property(env, "HYPERDRIVE"),
    "connectionString",
  );
  add(hyperdrive);
  for (const connection of [stringProperty(env, "DATABASE_URL"), hyperdrive]) {
    if (!connection) continue;
    try {
      const url = new URL(connection.trim().replace(/^(["'])(.*)\1$/, "$2"));
      add(url.password);
      let password = url.password;
      // Match encoded provider text as well as the decoded DB password, without
      // assuming the input URI was encoded correctly or exactly once.
      for (let depth = 0; depth < 3; depth++) {
        try {
          const decoded = decodeURIComponent(password);
          add(decoded);
          add(encodeURIComponent(decoded));
          if (decoded === password) break;
          password = decoded;
        } catch {
          break;
        }
      }
    } catch {
      // A malformed URI still gets removed by exact matching and URI redaction.
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}
function redactMessage(value: unknown, secrets: string[]): string {
  let text =
    typeof value === "string" ? value : stringProperty(value, "message");
  if (!text) return "Unknown database error";
  // Redact before bounding, so cutting an unusually long value cannot expose a
  // prefix of a known password or connection string.
  for (const secret of secrets) {
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), REDACTED);
  }
  text = text.slice(0, 32768);
  text = text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]+/gi, REDACTED)
    .replace(/\b[^\s:@/]+:[^\s@/]+@[^\s"'`<>]+/g, REDACTED)
    .replace(/"(?:\\.|[^"\\])*"/g, REDACTED)
    .replace(/'(?:\\.|[^'\\])*'/g, REDACTED)
    .replace(/`(?:\\.|[^`\\])*`/g, REDACTED)
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g,
      REDACTED,
    )
    .replace(/\bsb_[A-Za-z0-9_-]+/g, REDACTED)
    .replace(
      /\b(password|passwd|secret|service_role(?:_key)?|authorization|token|api[_-]?key|access[_-]?token|refresh[_-]?token|database_url|setup_token)\s*[:=]\s*[^\s,;]+/gi,
      `$1=${REDACTED}`,
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, REDACTED);
  // Stop at the first line; provider messages can embed stack traces or SQL on
  // later lines. Also suppress inline SQL and explicit query/parameters fields.
  text = text.split(/[\r\n\u2028\u2029]/, 1)[0];
  text = text.replace(
    /\b(?:select\b|insert\s+into\b|update\s+\S+\s+set\b|delete\s+from\b|(?:create|alter|drop)\s+(?:table|schema|function|index)\b|with\s+\S+\s+as\s*\(|(?:query|sql|parameters|args)\s*[:=])[\s\S]*/i,
    "[SQL redacted]",
  );
  text = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!text) return "Unknown database error";
  return text.length > LIMIT
    ? text.slice(0, LIMIT - 12) + " [truncated]"
    : text;
}
export function databaseErrorLog(error: unknown, env: Partial<AppEnv>) {
  const secrets = secretValues(env);
  const result: { message: string; cause?: string } = {
    message: redactMessage(error, secrets),
  };
  const cause = property(error, "cause");
  if (cause !== undefined && cause !== error)
    result.cause = redactMessage(cause, secrets);
  return result;
}
