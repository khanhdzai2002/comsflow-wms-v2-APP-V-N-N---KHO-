import {
  beginReturnMedia,
  finishReturnMedia,
  downloadReturnMedia,
} from "../lib/return-media";
import { archiveReturnIntake } from "../lib/return-source-archive";
import { startReturnReport, returnReportPage } from "../lib/return-reports";
import { assignReturnCases } from "../lib/return-operation-actions";
import { storage } from "../lib/supabase";
import { z } from "zod";
import { db, type User } from "../lib/db";
import { AppRequest, AppResponse } from "./http";
import { AppError, managerRoles, requireRole } from "../lib/domain";
import {
  returnOperationsStatus,
  requireReturnOperations,
} from "../lib/return-operations-access";
import {
  returnOperationList,
  returnOperationOverview,
  returnReceiptList,
} from "../lib/return-operation-query";
import {
  returnHandover,
  verifyReturnReceipt,
  reconcileReturnReceipts,
} from "../lib/return-receipts";
export async function returnOperationRequest(req: AppRequest, user: User) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, "");
  if (!path.startsWith("returns/operations")) return null;
  if (path === "returns/operations/status")
    return AppResponse.json(await returnOperationsStatus());
  await requireReturnOperations();
  const filters = Object.fromEntries(req.nextUrl.searchParams),
    sql = db();
  const read = async () => {
    const reader = req.body?.getReader();
    if (!reader) throw new AppError(400, "Thiếu dữ liệu");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new AppError(413, "Yêu cầu quá lớn");
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  if (path === "returns/operations/reports" && req.method === "POST")
    return AppResponse.json(await startReturnReport(user, await read()));
  if (
    /^returns\/operations\/reports\/[a-f0-9-]{36}$/.test(path) &&
    req.method === "GET"
  )
    return AppResponse.json(
      await returnReportPage(
        user,
        path.split("/")[3],
        z.coerce
          .number()
          .int()
          .min(0)
          .max(50000)
          .parse(filters.offset ?? 0),
      ),
    );
  if (path === "returns/operations/media" && req.method === "POST")
    return AppResponse.json(await beginReturnMedia(user, await read()));
  if (
    /^returns\/operations\/media\/[a-f0-9-]{36}\/finalize$/.test(path) &&
    req.method === "POST"
  )
    return AppResponse.json(await finishReturnMedia(user, path.split("/")[3]));
  if (
    /^returns\/operations\/media\/[a-f0-9-]{36}$/.test(path) &&
    req.method === "GET"
  )
    return new AppResponse(null, {
      status: 302,
      headers: {
        Location: await downloadReturnMedia(user, path.split("/")[3]),
        "Cache-Control": "no-store",
      },
    });
  if (path === "returns/operations/assign" && req.method === "POST")
    return AppResponse.json(await assignReturnCases(user, await read()));
  if (path === "returns/operations/cases" && req.method === "GET")
    return AppResponse.json(await returnOperationList(user, filters));
  if (path === "returns/operations/overview" && req.method === "GET")
    return AppResponse.json(await returnOperationOverview(user, filters));
  if (path === "returns/operations/receipts" && req.method === "GET")
    return AppResponse.json(await returnReceiptList(user, filters));
  if (path === "returns/operations/verify-receipt" && req.method === "POST")
    return AppResponse.json(await verifyReturnReceipt(user, await read()));
  if (path === "returns/operations/handovers" && req.method === "POST")
    return AppResponse.json(await returnHandover(user, await read()));
  if (
    /^returns\/operations\/handovers\/[a-f0-9-]{36}$/.test(path) &&
    req.method === "GET"
  ) {
    const id = path.split("/")[3];
    const [session] =
      await sql`SELECT * FROM return_handover_sessions WHERE id=${id} AND (${user.role !== "staff"} OR created_by=${user.id})`;
    if (!session) throw new AppError(404, "Không có quyền xem phiên nhận này");
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000000)
      .parse(filters.page ?? 1);
    const [count] =
      await sql`SELECT count(*)::int total FROM return_receipts WHERE session_id=${id} AND source_active`;
    const receipts =
      await sql`SELECT r.id,r.tracking_code,r.order_code,r.received_at,u.name employee FROM return_receipts r JOIN users u ON u.id=r.recorded_by WHERE r.session_id=${id} AND r.source_active ORDER BY r.received_at,r.id LIMIT 50 OFFSET ${(page - 1) * 50}`;
    const media =
      await sql`SELECT id,filename,mime FROM return_media WHERE session_id=${id} AND state='ready' ORDER BY created_at`;
    return AppResponse.json({
      session,
      receipts,
      media,
      total: count.total,
      page,
      pageSize: 50,
    });
  }
  if (path === "returns/operations/handovers" && req.method === "GET") {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000000)
      .parse(filters.page ?? 1);
    return AppResponse.json(
      await sql`SELECT s.*,w.name warehouse,c.name carrier,u.name employee,(SELECT count(*)::int FROM return_receipts r WHERE r.session_id=s.id AND r.source_active) parcels FROM return_handover_sessions s JOIN warehouses w ON w.id=s.warehouse_id LEFT JOIN shipping_carriers c ON c.id=s.carrier_id JOIN users u ON u.id=s.created_by WHERE (${user.role !== "staff"} OR s.created_by=${user.id}) AND (${filters.open !== "1"} OR s.closed_at IS NULL) ORDER BY s.started_at DESC LIMIT 100 OFFSET ${(page - 1) * 100}`,
    );
  }
  if (path === "returns/operations/reconcile" && req.method === "POST") {
    requireRole(user, managerRoles);
    const d = z.object({ cursor: z.uuid().optional() }).parse(await read());
    return AppResponse.json(
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(742920)`;
        return reconcileReturnReceipts(tx, user, undefined, undefined, {
          after: d.cursor,
          limit: 1000,
        });
      }),
    );
  }
  if (
    /^returns\/operations\/imports\/[a-f0-9-]{36}\/original$/.test(path) &&
    req.method === "GET"
  ) {
    requireRole(user, managerRoles);
    const [source] =
      await sql`SELECT j.storage_path,j.filename FROM return_intake_batches b JOIN data_jobs j ON j.id=b.id WHERE b.id=${path.split("/")[3]}`;
    if (!source?.storage_path)
      throw new AppError(404, "Không có tệp gốc đã lưu");
    const signed = await storage().createSignedUrl(source.storage_path, 60, {
      download: source.filename,
    });
    if (signed.error)
      throw new AppError(503, "Chưa tải được nguồn gốc; kiểm tra Storage");
    return new AppResponse(null, {
      status: 302,
      headers: { Location: signed.data.signedUrl, "Cache-Control": "no-store" },
    });
  }
  if (path === "returns/operations/imports/archive" && req.method === "POST")
    return AppResponse.json(await archiveReturnIntake(user, await read()));
  if (path === "returns/operations/imports" && req.method === "GET") {
    requireRole(user, managerRoles);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000000)
      .parse(filters.page ?? 1);
    const rows =
      await sql`SELECT b.*,j.filename,u.name employee,(SELECT count(*)::int FROM return_intake_rows r WHERE r.batch_id=b.id AND r.import_id IS NOT NULL AND EXISTS(SELECT 1 FROM return_import_archives a WHERE a.import_id=r.import_id)) archived_rows FROM return_intake_batches b JOIN data_jobs j ON j.id=b.id JOIN users u ON u.id=b.created_by ORDER BY b.created_at DESC,b.id LIMIT 50 OFFSET ${(page - 1) * 50}`;
    const [count] =
      await sql`SELECT count(*)::int total FROM return_intake_batches`;
    return AppResponse.json({ rows, total: count.total, page });
  }
  throw new AppError(404, "Không có chức năng hàng hoàn này");
}
