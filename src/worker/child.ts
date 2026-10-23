import { executeJob } from "./execute";
import { db } from "../lib/db";
import { AppError } from "../lib/domain";
const [id, token] = process.argv.slice(2);
try {
  await executeJob(id, token);
  process.send?.({ ok: true });
} catch (error) {
  process.send?.({
    ok: false,
    error:
      error instanceof AppError
        ? error.message
        : "Tác vụ tạm thời chưa hoàn tất. Kiểm tra worker và kết nối database.",
    retryable: !(error instanceof AppError) || error.status >= 500,
  });
  process.exitCode = 1;
} finally {
  await db().end({ timeout: 5 });
}
