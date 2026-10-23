import type { AppEnv } from "../server/context";
import { AppError } from "./domain";

export class DatabaseConfigurationError extends AppError {
  constructor(
    public code: string,
    message: string,
  ) {
    super(503, message);
  }
}
const fail = (code: string, message: string): never => {
  throw new DatabaseConfigurationError(code, message);
};
export function databaseConnection(
  env: Partial<AppEnv>,
  applicationName = "comsflow-web",
  statementTimeout = 30000,
) {
  let value = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!value?.trim())
    fail(
      "DB_URL_MISSING",
      "Chưa có DATABASE_URL ở runtime. Mở Cloudflare → Worker → Settings → Variables and Secrets, thêm Secret DATABASE_URL rồi Deploy.",
    );
  value = value!.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    value = value.slice(1, -1).trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(
      "DB_URL_INVALID",
      "DATABASE_URL phải là chuỗi URI bắt đầu bằng postgresql:// lấy từ Supabase Connect, không phải Project URL hay API key.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url!.protocol) ||
    !url!.hostname ||
    url!.hash
  )
    fail(
      "DB_URL_INVALID",
      "DATABASE_URL chưa đúng URI PostgreSQL. Sao chép lại từ Supabase Connect; mã hóa ký tự đặc biệt trong mật khẩu.",
    );
  let username: string, password: string;
  try {
    username = decodeURIComponent(url!.username);
    password = decodeURIComponent(url!.password);
  } catch {
    fail(
      "DB_PASSWORD_ENCODING",
      "Mật khẩu trong DATABASE_URL có mã hóa không hợp lệ. Dùng percent-encoding cho ký tự đặc biệt, mỗi ký tự chỉ mã hóa một lần.",
    );
  }
  if (!username!)
    fail(
      "DB_USER_MISSING",
      "DATABASE_URL thiếu username. Sao chép đầy đủ URI từ Supabase Connect.",
    );
  if (
    /\[your[-_ ]?(?:database[-_ ]?)?password\]|\[password\]|<password>/i.test(
      password!,
    )
  )
    fail(
      "DB_PASSWORD_PLACEHOLDER",
      "DATABASE_URL vẫn chứa phần mật khẩu mẫu. Thay [YOUR-PASSWORD] bằng mật khẩu database, bỏ dấu ngoặc vuông.",
    );
  const supabase = /(?:^|\.)supabase\.(?:co|com)$/i.test(url!.hostname);
  const pooler = /(?:^|\.)pooler\.supabase\.com$/i.test(url!.hostname);
  if (supabase && !password!)
    fail(
      "DB_PASSWORD_MISSING",
      "DATABASE_URL chưa có mật khẩu database. Đây là mật khẩu đặt lúc tạo project, không phải Publishable key hoặc mật khẩu đăng nhập app.",
    );
  if (supabase && !url!.pathname.replaceAll("/", ""))
    fail(
      "DB_NAME_MISSING",
      "DATABASE_URL thiếu tên database. Sao chép đầy đủ URI từ Supabase Connect.",
    );
  if (pooler) {
    let project: string | undefined;
    try {
      const host = new URL(env.SUPABASE_URL || "").hostname;
      if (host.endsWith(".supabase.co")) project = host.split(".")[0];
    } catch {
      /* Project URL is checked by the Auth/Storage client. */
    }
    if (
      !username!.includes(".") ||
      (project && !username!.endsWith("." + project))
    )
      fail(
        "DB_POOLER_USER_INVALID",
        "Username Pooler phải có dạng postgres.PROJECT_REF của đúng project. Sao chép URI ở Supabase → Connect → Transaction pooler, không dùng username postgres đơn lẻ.",
      );
    // ORM-only query options are not PostgreSQL startup parameters. Supavisor
    // can reject connections if these are sent in the startup packet.
    for (const name of [
      "pgbouncer",
      "connection_limit",
      "pool_timeout",
      "schema",
      "statement_timeout",
    ])
      url!.searchParams.delete(name);
  }
  const sslMode =
    url!.searchParams.get("sslmode") ?? url!.searchParams.get("ssl");
  if (supabase && ["disable", "false", "0"].includes(sslMode || ""))
    fail(
      "DB_TLS_REQUIRED",
      "Kết nối Supabase cần TLS. Bỏ sslmode=disable hoặc đổi thành sslmode=require trong DATABASE_URL.",
    );
  return {
    url: url!.toString(),
    secure:
      supabase ||
      Boolean(sslMode && !["disable", "false", "0"].includes(sslMode)),
    options: {
      ...(supabase && !sslMode ? { ssl: "require" as const } : {}),
      prepare: false,
      connection: {
        application_name: applicationName,
        ...(!pooler ? { statement_timeout: statementTimeout } : {}),
      },
    },
  };
}
export type DatabaseFailure = { code: string; error: string; hint: string };
export function databaseFailure(error: unknown): DatabaseFailure {
  if (error instanceof DatabaseConfigurationError)
    return {
      code: error.code,
      error: "Chưa cấu hình được kết nối database.",
      hint: error.message,
    };
  const record =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown; cause?: unknown })
      : {};
  const code = typeof record.code === "string" ? record.code : "";
  // Raw provider messages are used only for classification, never returned or logged.
  const message = typeof record.message === "string" ? record.message : "";
  const result = (code: string, hint: string): DatabaseFailure => ({
    code,
    error: "Chưa kết nối được database.",
    hint,
  });
  if (code === "DB_CONNECTION_RETRY_LIMIT")
    return result(
      "DB_CONNECTION_RETRY_LIMIT",
      "Kết nối bị đóng trước khi khởi tạo xong. App đã dừng thử lại để tránh vượt giới hạn Cloudflare. Kiểm tra log runtimeDetails của lần gọi này.",
    );
  if (/too many subrequests/i.test(message))
    return result(
      "DB_SUBREQUEST_LIMIT",
      "Cloudflare đã chặn vì có quá nhiều kết nối/yêu cầu trong một lần gọi. Cập nhật bản sửa adapter và giới hạn thử lại; chưa kết luận cần nâng gói.",
    );
  if (/unsupported (?:startup )?parameter/i.test(message))
    return result(
      "DB_POOLER_PARAMETER_UNSUPPORTED",
      "Pooler từ chối tham số kết nối. Dùng bản triển khai mới nhất và URI loại Transaction pooler / URI, không dùng chuỗi cấu hình ORM.",
    );
  if (/tenant or user not found|tenant not found/i.test(message))
    return result(
      "DB_POOLER_USER_INVALID",
      "Username hoặc project trong URI Pooler chưa đúng. Sao chép lại URI từ Connect của đúng project.",
    );
  if (
    ["28P01", "28000"].includes(code) ||
    /password authentication failed|authentication error|invalid password|wrong password/i.test(
      message,
    )
  )
    return result(
      "DB_AUTH_FAILED",
      "Database từ chối username hoặc mật khẩu. Kiểm tra mật khẩu database và mã hóa ký tự đặc biệt; không dùng API key thay mật khẩu.",
    );
  if (code === "SASL_SIGNATURE_MISMATCH")
    return result(
      "DB_AUTH_SIGNATURE_FAILED",
      "Xác thực SCRAM chưa hoàn tất. Kiểm tra URI Pooler của đúng project và mật khẩu database; không tắt TLS.",
    );
  if (
    /cannot perform i\/o|different request|global scope|disallowed operation/i.test(
      message,
    )
  )
    return result(
      "DB_RUNTIME_IO_FAILED",
      "Cloudflare từ chối thao tác kết nối trong request. Cần kiểm tra adapter/runtime của bản triển khai; đổi mật khẩu không xử lý được lỗi này.",
    );
  if (code === "3D000")
    return result(
      "DB_NAME_INVALID",
      "Tên database trong URI chưa đúng. Sao chép đầy đủ URI từ Supabase Connect.",
    );
  if (["42P01", "42703"].includes(code))
    return result(
      "DB_SCHEMA_MISSING",
      "Kết nối đã đến database nhưng thiếu bảng/cột ComsFlow. Kiểm tra DATABASE_URL trỏ đúng project đã chạy 17 migration; không xóa bảng.",
    );
  if (code === "42501")
    return result(
      "DB_PERMISSION_DENIED",
      "Tài khoản database trong URI chưa có quyền đọc bảng ComsFlow. Kiểm tra đúng username trong Supabase Connect.",
    );
  if (
    code === "53300" ||
    /maxclients|max clients|too many connections/i.test(message)
  )
    return result(
      "DB_POOLER_BUSY",
      "Pooler đang hết kết nối. Dùng Transaction pooler và thử lại sau; không tăng số kết nối tùy tiện.",
    );
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code))
    return result(
      "DB_DNS_FAILED",
      "Không tìm thấy máy chủ database. Kiểm tra hostname bằng URI mới sao chép từ Supabase Connect.",
    );
  if (["CONNECT_TIMEOUT", "ETIMEDOUT"].includes(code))
    return result(
      "DB_CONNECT_TIMEOUT",
      "Chưa kết nối được trong thời gian chờ. Kiểm tra project không bị pause, địa chỉ Pooler và cổng kết nối.",
    );
  if (
    [
      "DB_TLS_FAILED",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "CERT_HAS_EXPIRED",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    ].includes(code) ||
    /TLS|SSL|certificate/i.test(message)
  )
    return result(
      "DB_TLS_FAILED",
      "Chưa thiết lập được TLS với database. Dùng địa chỉ Pooler do Supabase cấp, không thay bằng IP hoặc tắt kiểm tra bảo mật.",
    );
  if (
    [
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "CONNECTION_CLOSED",
      "CONNECTION_DESTROYED",
      "CONNECTION_ENDED",
    ].includes(code) ||
    /proxy request failed|failed to connect|connection attempt failed|network connection lost|socket closed|connection reset|connection refused/i.test(
      message,
    )
  )
    return result(
      "DB_NETWORK_FAILED",
      "Kết nối database bị từ chối hoặc ngắt. Kiểm tra URI Pooler và trạng thái project Supabase.",
    );
  if (code === "57014")
    return result(
      "DB_QUERY_TIMEOUT",
      "Database chưa hoàn tất truy vấn trong thời gian chờ. Thử lại sau và kiểm tra tải database.",
    );
  if (record.cause && record.cause !== error) {
    const nested = databaseFailureWithoutCause(record.cause);
    if (nested.code !== "DB_CONNECTION_FAILED") return nested;
  }
  return result(
    "DB_CONNECTION_FAILED",
    "Kiểm tra runtime secrets và nhật ký Worker bằng mã yêu cầu. Không gửi DATABASE_URL hoặc mật khẩu vào chat.",
  );
}
function databaseFailureWithoutCause(error: unknown): DatabaseFailure {
  if (!error || typeof error !== "object")
    return {
      code: "DB_CONNECTION_FAILED",
      error: "Chưa kết nối được database.",
      hint: "Kiểm tra runtime secrets và nhật ký Worker.",
    };
  const record = error as { code?: unknown; message?: unknown };
  return databaseFailure({ code: record.code, message: record.message });
}

// Only known exception types and five-character SQLSTATE codes are public.
// Never include provider messages, stack traces or arbitrary error properties.
export function databaseErrorMetadata(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as {
          name?: unknown;
          code?: unknown;
          transportStage?: unknown;
          sentBytes?: unknown;
          receivedBytes?: unknown;
        })
      : {};
  const knownNames = [
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "PostgresError",
    "DOMException",
    "NotSupportedError",
    "OperationError",
  ];
  const stages = [
    "tcp_open",
    "tls_negotiation",
    "tls_open",
    "postgres_startup",
    "postgres_response",
  ];
  const safeCount = (value: unknown) =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER;
  return {
    ...(typeof record.transportStage === "string" &&
    stages.includes(record.transportStage)
      ? { transportStage: record.transportStage }
      : {}),
    ...(safeCount(record.sentBytes) ? { sentBytes: record.sentBytes } : {}),
    ...(safeCount(record.receivedBytes)
      ? { receivedBytes: record.receivedBytes }
      : {}),
    errorType:
      typeof record.name === "string" && knownNames.includes(record.name)
        ? record.name
        : "Other",
    sqlState:
      typeof record.code === "string" && /^[0-9A-Z]{5}$/.test(record.code)
        ? record.code
        : null,
  };
}
