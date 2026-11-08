import { z } from "zod";
import { db, audit, type User } from "./db";
import { AppError, managerRoles, requireRole } from "./domain";
import { operationFilters, operationWhere } from "./return-operation-query";
import { requireReturnOperations } from "./return-operations-access";
export async function startReturnReport(user: User, raw: unknown) {
  requireRole(user, managerRoles);
  await requireReturnOperations();
  const f = operationFilters.parse({
      ...(raw as object),
      state: "needs_check",
      archived: false,
      page: 1,
    }),
    where = operationWhere(user, f),
    sql = db();
  return sql.begin("isolation level repeatable read", async (tx) => {
    await tx`SET LOCAL jit=off`;
    await tx`DELETE FROM return_report_sessions WHERE expires_at<now()`;
    const [report] =
      await tx`INSERT INTO return_report_sessions(created_by,filters) VALUES(${user.id},${tx.json(f)}) RETURNING *`;
    const [count] =
      await tx`SELECT count(*)::int rows,count(DISTINCT r.id)::int cases FROM return_operation_rows r LEFT JOIN return_items i ON i.case_id=r.id AND i.active WHERE ${where}`;
    if (!count.rows || !count.cases)
      throw new AppError(
        400,
        "Không có đơn chưa nhận cần kiểm tra trong bộ lọc; không tạo sheet trống",
      );
    if (count.rows > 50000)
      throw new AppError(
        413,
        "Báo cáo tối đa 50.000 dòng sản phẩm. Thu hẹp ngày hoặc đơn vị vận chuyển",
      );
    await tx`INSERT INTO return_report_rows(report_id,ordinal,carrier,row_data)
   SELECT ${report.id},row_number() OVER(ORDER BY r.carrier,r.order_code,r.id,i.id),r.carrier,
    jsonb_build_object('caseId',r.id,'order',r.order_code,'tracking',r.tracking_codes,'carrier',r.carrier,'orderedAt',r.ordered_at,'returnAt',coalesce(r.cancelled_at,r.requested_at),'reason',r.reason_original,'platformStatus',r.platform_status||CASE WHEN r.platform_substatus<>'' THEN ' / '||r.platform_substatus ELSE '' END,
     'product',coalesce(i.name,''),'sku',coalesce(nullif(i.seller_sku,''),i.sku_id,''),'quantity',i.expected_qty,
     'orderAmount',CASE WHEN row_number() OVER(PARTITION BY r.shop_id,r.order_code ORDER BY r.carrier,r.id,i.id)=1 THEN r.source_order_amount::text ELSE NULL END,
     'receiptState',CASE r.primary_state WHEN 'suspected_lost' THEN 'Nghi thất lạc – cần xác minh' WHEN 'lost' THEN 'Đã xác nhận mất' ELSE 'Chưa nhận – cần kiểm tra' END,
     'courier','','receivedAt',NULL,'verification',r.verification_status,'carrierResult',r.verification_result,'note','')
   FROM return_operation_rows r LEFT JOIN return_items i ON i.case_id=r.id AND i.active WHERE ${where} ORDER BY r.carrier,r.order_code,r.id,i.id`;
    await tx`UPDATE return_report_sessions SET total_rows=${count.rows},total_cases=${count.cases} WHERE id=${report.id}`;
    await audit(
      tx,
      user,
      "return_report_snapshot",
      report.id,
      null,
      { filters: f, rows: count.rows, cases: count.cases },
      "Chốt đúng tập tra soát, giữ mã text và loại thông tin cá nhân khách hàng",
    );
    return {
      ...report,
      id: report.id as string,
      created_at: report.created_at as string,
      total_rows: count.rows,
      total_cases: count.cases,
    };
  });
}
export async function returnReportPage(user: User, id: string, offset: number) {
  requireRole(user, managerRoles);
  z.uuid().parse(id);
  z.number().int().min(0).max(50000).parse(offset);
  const sql = db();
  const [report] =
    await sql`SELECT * FROM return_report_sessions WHERE id=${id} AND created_by=${user.id} AND expires_at>now()`;
  if (!report)
    throw new AppError(
      404,
      "Báo cáo không tồn tại, không thuộc bạn hoặc đã hết hạn",
    );
  const rows =
    await sql`SELECT ordinal,carrier,row_data FROM return_report_rows WHERE report_id=${id} AND ordinal>${offset} ORDER BY ordinal LIMIT 1000`;
  return { report, rows, done: offset + rows.length >= report.total_rows };
}
