import { db, type Tx, type User } from "./db";
import { AppError } from "./domain";
export async function returnOperationsStatus(
  sql: Tx | ReturnType<typeof db> = db(),
) {
  const [row] = await sql`
    WITH objects AS (
      SELECT name,to_regclass('public.'||name) id
      FROM unnest(ARRAY['return_operation_rows','return_handover_sessions','return_receipts','return_receipt_events','return_source_versions','return_import_archives','return_intake_batches','return_intake_rows','return_media','return_report_sessions','return_report_rows']) name
    )
    SELECT bool_and(id IS NOT NULL) ready,
      coalesce(bool_and(
        id IS NOT NULL
        AND has_table_privilege(id,'SELECT')
        AND (name='return_operation_rows' OR has_table_privilege(id,'INSERT'))
        AND (name IN ('return_operation_rows','return_receipt_events','return_source_versions') OR (has_table_privilege(id,'UPDATE') AND has_table_privilege(id,'DELETE')))
      ),false)
      AND coalesce(has_function_privilege(to_regprocedure('public.return_operation_carrier(text,text,uuid,text)'),'EXECUTE'),false) permissions
    FROM objects`;
  return row as { ready: boolean; permissions: boolean };
}
export async function requireReturnOperations(
  sql: Tx | ReturnType<typeof db> = db(),
) {
  const status = await returnOperationsStatus(sql);
  if (!status.ready)
    throw new AppError(
      503,
      "Cần nâng cấp cấu trúc Quản lý & Đối soát hàng hoàn. Admin mở thông báo SQL trong app; dữ liệu cũ vẫn được giữ.",
    );
  if (!status.permissions)
    throw new AppError(
      503,
      "Tài khoản máy chủ thiếu quyền hàng hoàn mới. Admin chạy lại SQL cấp quyền của bản nâng cấp; không đổi mật khẩu.",
    );
}
export async function requireReturnCaseAccess(
  user: User,
  id: string,
  sql: Tx | ReturnType<typeof db> = db(),
) {
  if (user.role !== "staff") return;
  if (
    (await returnOperationsStatus(sql)).ready &&
    (
      await sql`SELECT 1 FROM return_receipts WHERE case_id=${id} AND recorded_by=${user.id} AND source_active AND match_state='matched'`
    ).length
  )
    return;
  const [r] =
    await sql`SELECT r.id FROM return_cases r WHERE r.id=${id} AND (r.assigned_to=${user.id} OR EXISTS(SELECT 1 FROM return_parcels p WHERE p.case_id=r.id AND p.received_by=${user.id}) OR EXISTS(SELECT 1 FROM return_events e WHERE e.case_id=r.id AND e.actor_id=${user.id} AND e.action='received'))`;
  if (!r)
    throw new AppError(
      403,
      "Bạn chỉ được thao tác hồ sơ được phân công hoặc kiện do bạn nhận.",
    );
}
