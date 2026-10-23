import { carrierKey, carrierCatalog, identifyCarrier } from "@/lib/carriers";
import { returnAnalytics } from "@/lib/return-analytics";
import {
  returnSettings,
  saveReturnSettings,
  returnImportHistory,
} from "@/lib/return-settings";
import { salesFields } from "@/lib/sales-fields";
import { AppRequest as NextRequest, AppResponse as NextResponse } from "./http";
import { environment, requestContext } from "./context";
import { databaseHealth } from "./database-health";
import { supabase } from "../lib/supabase";
import { z } from "zod";

import { db, audit, type User } from "@/lib/db";
import {
  currentUser,
  login,
  sessionHash,
  sessionCookies,
  createAccount,
} from "@/lib/auth";
import {
  AppError,
  requireRole,
  managerRoles,
  statuses,
  warehouseIdSchema,
} from "@/lib/domain";
import { setupCatalogs } from "@/lib/catalog-setup";
import { scan } from "@/lib/scan";
import {
  referenceData,
  dashboard,
  shipmentList,
  myScans,
  type Filters,
} from "@/lib/queries";
import { fields } from "@/lib/import-fields";
import {
  createHandover,
  confirmHandover,
  cancelHandover,
} from "@/lib/handover";

import {
  listSources,
  sourceReport,
  setSourceArchived,
} from "@/lib/source-manifests";
import { startOwnShift, assignShift } from "@/lib/shifts";
import { verifyRequestOrigin } from "@/lib/request-origin";
import { bootstrapAdmin, setupStatus } from "@/lib/bootstrap";

import {
  previewCleanup,
  executeCleanup,
  cleanupExport,
  storageInfo,
  optimizeStorage,
} from "@/lib/maintenance";
import {
  returnList,
  returnDetail,
  receiveReturn,
  inspectReturn,
  updateReturn,
  undoReturn,
  saveReturnClaim,
  editReturnParcel,
} from "@/lib/returns";
const secure = () =>
  process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
const cookieOptions = () => ({
  httpOnly: true,
  secure: secure(),
  sameSite: "strict" as const,
  path: "/",
  maxAge: 12 * 60 * 60,
});
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
const id = (value: unknown) => z.uuid().parse(value);
async function limitedBody(
  req: NextRequest,
  limit: number,
  message = "Yêu cầu quá lớn",
) {
  if (Number(req.headers.get("content-length")) > limit)
    throw new AppError(413, message);
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new AppError(413, message);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function body(req: NextRequest) {
  return JSON.parse((await limitedBody(req, 1000000)).toString("utf8"));
}
async function exportData(
  rows: Record<string, any>[],
  format: string,
  filename: string,
) {
  const sink = requestContext.getStore()?.exportSink;
  if (!sink)
    throw new AppError(409, "Tạo tác vụ xuất báo cáo tại mục Tác vụ dữ liệu");
  return sink(rows, format, filename);
}
export async function dispatch(req: NextRequest, trustedUser?: User) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, "");
  if (path === "health" && req.method === "GET") return databaseHealth();
  const sql = db();
  // All cookie-authenticated mutations require same-origin, independent of CORS.
  if (req.method !== "GET" && !trustedUser) {
    verifyRequestOrigin(req, {
      appOrigin: environment().APP_ORIGIN,
    });
  }
  if (path === "auth/setup-status" && req.method === "GET") {
    return json(await setupStatus(environment().SETUP_TOKEN));
  }
  if (path === "auth/setup" && req.method === "POST") {
    const result = await bootstrapAdmin(
      await body(req),
      environment().SETUP_TOKEN,
    );
    const response = json({ user: result.user });
    for (const cookie of sessionCookies(
      result.token,
      result.refresh,
      result.expires,
    ))
      response.headers.append("Set-Cookie", cookie);
    return response;
  }
  if (path === "auth/login" && req.method === "POST") {
    const input = z
      .object({
        email: z.email().max(200),
        password: z.string().min(1).max(200),
      })
      .parse(await body(req));
    const result = await login(input.email, input.password);
    if ("error" in result)
      throw new AppError(401, "Email hoặc mật khẩu không đúng");
    const response = json({ user: result.user });
    for (const cookie of sessionCookies(
      result.token,
      result.refresh,
      result.expires,
    ))
      response.headers.append("Set-Cookie", cookie);
    return response;
  }
  const token = req.cookies.get("comsflow_session")?.value;
  const user = trustedUser ?? (await currentUser(token));
  if (!user) throw new AppError(401, "Vui lòng đăng nhập");
  if (path === "auth/me") return json({ user });
  if (path === "auth/logout" && req.method === "POST") {
    const access = requestContext.getStore()?.accessToken ?? token;
    if (access) {
      const result = await supabase(true).auth.admin.signOut(access, "local");
      if (
        result.error &&
        result.error.status !== 401 &&
        result.error.status !== 403
      )
        throw new AppError(503, "Chưa thu hồi được phiên đăng nhập. Thử lại.");
    }
    // Do not attach renewal cookies after logout.
    if (requestContext.getStore()) requestContext.getStore()!.cookies = [];
    if (token)
      await sql`DELETE FROM sessions WHERE token_hash=${sessionHash(token)}`;
    const r = json({ ok: true });
    r.cookies.set("comsflow_session", "", { ...cookieOptions(), maxAge: 0 });
    r.cookies.set("comsflow_refresh", "", { ...cookieOptions(), maxAge: 0 });
    return r;
  }
  if (path === "references" && req.method === "GET")
    return json(await referenceData(user));
  if (path === "scans" && req.method === "POST")
    return json(await scan(user, await body(req)));
  if (path === "scans/mine" && req.method === "GET")
    return json(
      await myScans(user, req.nextUrl.searchParams.get("shift") ?? undefined),
    );
  if (path.startsWith("returns")) {
    if (path === "returns/events/mine" && req.method === "GET")
      return json({
        events:
          await sql`SELECT e.*,u.name employee FROM return_events e JOIN users u ON u.id=e.actor_id WHERE e.actor_id=${user.id} ORDER BY e.created_at DESC LIMIT 20`,
      });
    if (path === "returns/analytics" && req.method === "GET")
      return json(
        await returnAnalytics(
          user,
          Object.fromEntries(req.nextUrl.searchParams),
        ),
      );
    if (path === "returns/v2-settings" && req.method === "GET")
      return json(await returnSettings(user));
    if (path === "returns/v2-settings" && req.method === "POST")
      return json(await saveReturnSettings(user, await body(req)));
    if (path === "returns/upload-history" && req.method === "GET") {
      requireRole(user, managerRoles);
      return json(
        await sql`SELECT a.*,u.name employee FROM return_upload_attempts a JOIN users u ON u.id=a.created_by ORDER BY a.created_at DESC LIMIT 100`,
      );
    }
    if (path === "returns/import-history" && req.method === "GET")
      return json(
        await returnImportHistory(
          user,
          req.nextUrl.searchParams.get("id") ?? undefined,
        ),
      );
    if (path === "returns/sales/template" && req.method === "GET") {
      requireRole(user, managerRoles);
      return exportData(
        [Object.fromEntries(Object.values(salesFields).map((v) => [v, ""]))],
        "xlsx",
        "mau-du-lieu-ban",
      );
    }
    if (path === "returns/sales/history" && req.method === "GET") {
      requireRole(user, managerRoles);
      return json(
        await sql`SELECT i.*,sh.name shop,ch.name channel,u.name employee FROM sales_imports i JOIN shops sh ON sh.id=i.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id JOIN users u ON u.id=i.created_by ORDER BY i.created_at DESC LIMIT 100`,
      );
    }
    if (path === "returns" && req.method === "GET")
      return json(
        await returnList(user, Object.fromEntries(req.nextUrl.searchParams)),
      );
    if (path === "returns/export" && req.method === "GET") {
      requireRole(user, managerRoles);
      const f = Object.fromEntries(req.nextUrl.searchParams);
      const data = await returnList(user, f, true);
      return exportData(
        data.rows.map((r) => ({
          request: r.external_id,
          order: r.order_code,
          channel: r.channel,
          shop: r.shop,
          warehouse: r.warehouse,
          requested_at: r.requested_at,
          platform_status: r.platform_status,
          platform_substatus: r.platform_substatus,
          parcels: r.parcels,
          received_parcels: r.received,
          requested_products: r.quantity,
          inspected_products: r.received_quantity,
          inspection: r.inspection_status,
          needs_recheck: r.inspection_stale,
          processing: r.processing_status,
          no_physical_return: r.no_physical_return,
          claim_requested: r.claim_requested,
          claim_approved: r.claim_approved,
          claim_received: r.claim_received,
          source_file: r.source_file,
        })),
        f.format ?? "xlsx",
        "return-reconciliation",
      );
    }
    if (path === "returns/receive" && req.method === "POST")
      return json(await receiveReturn(user, await body(req)));
    if (path === "returns/inspect" && req.method === "POST")
      return json(await inspectReturn(user, await body(req)));
    if (path === "returns/update" && req.method === "POST")
      return json(await updateReturn(user, await body(req)));
    if (path === "returns/undo" && req.method === "POST")
      return json(await undoReturn(user, await body(req)));
    if (path === "returns/claim" && req.method === "POST")
      return json(await saveReturnClaim(user, await body(req)));
    if (path === "returns/parcel" && req.method === "POST")
      return json(await editReturnParcel(user, await body(req)));
    if (path === "returns/settings" && req.method === "POST") {
      requireRole(user, managerRoles);
      const value = z
        .object({ days: z.number().int().min(1).max(90) })
        .parse(await body(req));
      await sql.begin(async (tx) => {
        const [before] =
          await tx`SELECT value FROM system_settings WHERE key='return_overdue_days'`;
        await tx`INSERT INTO system_settings(key,value) VALUES('return_overdue_days',${tx.json(value.days)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
        await audit(
          tx,
          user,
          "return_settings",
          "return_overdue_days",
          before ?? null,
          value,
          "Cấu hình mốc cảnh báo tham khảo; không tự kết luận mất đơn",
        );
      });
      return json({ ok: true });
    }
    if (path === "returns/evidence" && req.method === "POST") {
      const bytes = await limitedBody(req, 6 * 1024 * 1024);
      const form = await new Request(req.url, {
        method: "POST",
        headers: { "Content-Type": req.headers.get("content-type") ?? "" },
        body: bytes,
      }).formData();
      const caseId = z.uuid().parse(form.get("caseId")),
        file = form.get("file");
      if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
        throw new AppError(400, "Bằng chứng tối đa 5 MB");
      const b = Buffer.from(await file.arrayBuffer());
      const mime =
        b.subarray(0, 5).toString() === "%PDF-"
          ? "application/pdf"
          : b
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : b[0] === 255 && b[1] === 216 && b[2] === 255
              ? "image/jpeg"
              : null;
      if (!mime)
        throw new AppError(
          400,
          "Chỉ nhận PNG, JPEG hoặc PDF có nội dung hợp lệ",
        );
      return json(
        await sql.begin(async (tx) => {
          if (
            !(
              await tx`SELECT id FROM return_cases WHERE id=${caseId} FOR UPDATE`
            ).length
          )
            throw new AppError(404, "Không có yêu cầu");
          const [{ n }] =
            await tx`SELECT count(*)::int n FROM return_evidence WHERE case_id=${caseId}`;
          if (n >= 20)
            throw new AppError(400, "Mỗi yêu cầu tối đa 20 bằng chứng");
          const [record] =
            await tx`INSERT INTO return_evidence(case_id,filename,mime,bytes,created_by) VALUES(${caseId},${file.name.slice(0, 255)},${mime},${b},${user.id}) RETURNING id`;
          await tx`INSERT INTO return_events(case_id,actor_id,action,data) VALUES(${caseId},${user.id},'evidence',${tx.json({ id: record.id, filename: file.name })})`;
          return record;
        }),
      );
    }
    if (/^returns\/evidence\/[^/]+$/.test(path) && req.method === "GET") {
      const [e] =
        await sql`SELECT * FROM return_evidence WHERE id=${id(path.split("/")[2])}`;
      if (!e) throw new AppError(404, "Không có bằng chứng");
      return new NextResponse(e.bytes, {
        headers: {
          "Content-Type": e.mime,
          "Content-Disposition": `attachment; filename="evidence.${e.mime === "application/pdf" ? "pdf" : e.mime === "image/png" ? "png" : "jpg"}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    }
    if (/^returns\/[^/]+$/.test(path) && req.method === "GET")
      return json(await returnDetail(user, path.split("/")[1]));
    throw new AppError(404, "Không có chức năng đơn hoàn này");
  }
  // Staff routes end here. Everything below is manager/admin only.
  requireRole(user, managerRoles);
  const filters = Object.fromEntries(req.nextUrl.searchParams) as Filters;
  if (path === "scans/history" && req.method === "GET") {
    const outcome = z
      .enum([
        "",
        "duplicate",
        "unknown",
        "success",
        "invalid",
        "cancelled",
        "blocked",
        "carrier_mismatch",
        "warehouse_mismatch",
      ])
      .parse(req.nextUrl.searchParams.get("outcome") ?? "");
    return json(
      await sql`SELECT e.id,e.raw_code,e.outcome,e.created_at,e.method,u.name employee,w.name warehouse,ws.name shift FROM scan_events e JOIN users u ON u.id=e.user_id JOIN warehouses w ON w.id=e.warehouse_id JOIN work_shifts ws ON ws.id=e.shift_id WHERE (${!outcome} OR e.outcome=${outcome}) ORDER BY e.created_at DESC LIMIT 500`,
    );
  }
  if (path === "dashboard" && req.method === "GET")
    return json(await dashboard(user, filters));
  if (path === "shipments" && req.method === "GET")
    return json(await shipmentList(user, filters));
  if (path.startsWith("shipments/") && req.method === "GET") {
    const shipmentId = id(path.split("/")[1]);
    const [shipment] =
      await sql`SELECT s.*,o.external_id,c.name channel,ca.name carrier,sh.name shop,w.name warehouse,u.name employee,h.name handover_employee FROM shipments s JOIN orders o ON o.id=s.order_id JOIN sales_channels c ON c.id=o.channel_id JOIN shops sh ON sh.id=o.shop_id JOIN warehouses w ON w.id=s.warehouse_id JOIN shipping_carriers ca ON ca.id=s.carrier_id LEFT JOIN users u ON u.id=s.scanned_by LEFT JOIN users h ON h.id=s.handed_by WHERE s.id=${shipmentId}`;
    if (!shipment) throw new AppError(404, "Không tìm thấy vận đơn");
    const [items, events, logs] = await Promise.all([
      sql`SELECT * FROM order_items WHERE order_id=${shipment.order_id}`,
      sql`SELECT e.*,u.name employee FROM scan_events e JOIN users u ON u.id=e.user_id WHERE e.shipment_id=${shipmentId} ORDER BY e.created_at`,
      sql`SELECT a.*,u.name employee FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity_id IN (${shipmentId},${shipment.order_id}) ORDER BY a.created_at DESC`,
    ]);
    return json({ shipment, items, events, logs });
  }
  if (path === "shipments/adjust" && req.method === "POST") {
    const d = z
      .object({
        id: z.uuid(),
        status: z.enum([
          "awaiting_scan",
          "scanned",
          "blocked",
          "cancelled",
          "review",
        ]),
        reason: z.string().trim().min(8).max(1000),
      })
      .parse(await body(req));
    return json(
      await sql.begin(async (tx) => {
        const [before] =
          await tx`SELECT * FROM shipments WHERE id=${d.id} FOR UPDATE`;
        if (!before) throw new AppError(404, "Không tìm thấy đơn");
        if (before.handed_at)
          throw new AppError(
            409,
            "Đơn đã bàn giao không thể điều chỉnh bằng thao tác này",
          );
        const [inBatch] =
          await tx`SELECT * FROM handover_items WHERE shipment_id=${d.id} AND released_at IS NULL`;
        if (inBatch)
          throw new AppError(
            409,
            "Đơn đang thuộc phiếu bàn giao; không thể đổi trạng thái",
          );
        if (d.status === "scanned" && !before.scanned_at)
          throw new AppError(409, "Chưa có lịch sử quét hợp lệ");
        if (d.status === "awaiting_scan" && before.scanned_at)
          throw new AppError(
            409,
            "Không thể xóa trạng thái đã quét. Lịch sử phải được bảo toàn.",
          );
        const [after] =
          await tx`UPDATE shipments SET status=${d.status},note=${d.reason},updated_at=now() WHERE id=${d.id} RETURNING *`;
        await audit(tx, user, "shipment_adjust", d.id, before, after, d.reason);
        return after;
      }),
    );
  }
  if (path === "sources" && req.method === "GET")
    return json(
      await listSources(
        user,
        z
          .enum(["active", "archived"])
          .parse(req.nextUrl.searchParams.get("scope") ?? "active") ===
          "archived",
      ),
    );
  if (
    (path === "sources/archive" || path === "sources/restore") &&
    req.method === "POST"
  )
    return json(
      await setSourceArchived(
        user,
        await body(req),
        path === "sources/archive",
      ),
    );
  if (path.startsWith("sources/") && req.method === "GET") {
    const report = await sourceReport(user, path.split("/")[1]);
    if (req.nextUrl.searchParams.has("format"))
      return exportData(
        report.rows.map((r) => ({
          source_archived: report.manifest.archived_at
            ? "Đã loại bỏ"
            : "Đang dùng",
          source_file: report.manifest.filename,
          channel: report.manifest.channel,
          shop: report.manifest.shop,
          tracking_code: r.tracking_code,
          order_id: r.external_id,
          pages: r.pages.join(", "),
          status: statuses[r.status] ?? r.status,
          scanned_at: r.scanned_at,
          handed_at: r.handed_at,
          warehouse: r.warehouse,
          carrier: r.carrier,
          context_changed: r.contextChanged ? "Có" : "Không",
          scanned_before_import: r.scanned_before_import ? "Có" : "Không",
          handed_before_import: r.handed_before_import ? "Có" : "Không",
        })),
        req.nextUrl.searchParams.get("format") ?? "csv",
        "source-reconciliation",
      );
    return json(report);
  }
  if (path === "imports" && req.method === "GET")
    return json(
      await sql`SELECT b.*,u.name employee FROM import_batches b JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC LIMIT 100`,
    );
  if (path === "imports/template" && req.method === "POST") {
    const d = z
      .object({
        name: z.string().trim().min(2).max(100),
        mapping: z.record(z.enum(fields), z.string().max(200)),
      })
      .parse(await body(req));
    return json(
      await sql.begin(async (tx) => {
        const [before] =
          await tx`SELECT * FROM import_templates WHERE name=${d.name}`;
        const [after] =
          await tx`INSERT INTO import_templates(name,mapping,created_by) VALUES(${d.name},${tx.json(d.mapping)},${user.id}) ON CONFLICT(name) DO UPDATE SET mapping=excluded.mapping RETURNING *`;
        await audit(
          tx,
          user,
          "template_save",
          after.id,
          before ?? null,
          after,
          "Lưu ánh xạ nhập liệu",
        );
        return after;
      }),
    );
  }
  if (path === "exceptions" && req.method === "GET")
    return json(
      await sql`SELECT x.*,e.raw_code,e.outcome,u.name employee,s.tracking_code,s.status shipment_status FROM exception_cases x LEFT JOIN scan_events e ON e.id=x.scan_event_id LEFT JOIN users u ON u.id=e.user_id LEFT JOIN shipments s ON s.id=x.shipment_id ORDER BY x.created_at DESC LIMIT 500`,
    );
  if (path === "exceptions/resolve" && req.method === "POST") {
    const d = z
      .object({ id: z.uuid(), reason: z.string().trim().min(8).max(1000) })
      .parse(await body(req));
    return json(
      await sql.begin(async (tx) => {
        const [before] =
          await tx`SELECT * FROM exception_cases WHERE id=${d.id} FOR UPDATE`;
        if (!before) throw new AppError(404, "Không tìm thấy ngoại lệ");
        const [after] =
          await tx`UPDATE exception_cases SET status='resolved',resolved_at=now(),resolved_by=${user.id},reason=${d.reason} WHERE id=${d.id} RETURNING *`;
        await audit(
          tx,
          user,
          "exception_resolve",
          d.id,
          before,
          after,
          d.reason,
        );
        return after;
      }),
    );
  }
  if (path === "handovers" && req.method === "POST")
    return json(await createHandover(user, await body(req)));
  if (path === "handovers/confirm" && req.method === "POST")
    return json(await confirmHandover(user, id((await body(req)).id)));
  if (path === "handovers/cancel" && req.method === "POST")
    return json(await cancelHandover(user, await body(req)));
  if (path === "handovers" && req.method === "GET")
    return json(
      await sql`SELECT b.*,c.name carrier,w.name warehouse,u.name employee,(SELECT count(*)::int FROM handover_items i WHERE i.batch_id=b.id) packages FROM handover_batches b JOIN shipping_carriers c ON c.id=b.carrier_id JOIN warehouses w ON w.id=b.warehouse_id JOIN users u ON u.id=b.created_by ORDER BY b.created_at DESC LIMIT 200`,
    );
  if (path === "export" && req.method === "GET") {
    const type = req.nextUrl.searchParams.get("type");
    let rows: Record<string, any>[];
    if (type === "errors") {
      const batch = id(req.nextUrl.searchParams.get("batch"));
      rows =
        await sql`SELECT row_number,message,raw::text FROM import_errors WHERE batch_id=${batch} ORDER BY row_number`;
    } else if (type === "exceptions") {
      rows =
        await sql`SELECT x.kind,x.status,e.raw_code,x.created_at,x.reason FROM exception_cases x LEFT JOIN scan_events e ON e.id=x.scan_event_id ORDER BY x.created_at DESC LIMIT 50000`;
    } else if (type === "handover") {
      const batch = id(req.nextUrl.searchParams.get("batch"));
      rows =
        await sql`SELECT s.tracking_code,o.external_id,c.name carrier,b.status,b.confirmed_at,b.note,'Ghi nhận bàn giao nội bộ' AS confirmation FROM handover_items i JOIN handover_batches b ON b.id=i.batch_id JOIN shipments s ON s.id=i.shipment_id JOIN orders o ON o.id=s.order_id JOIN shipping_carriers c ON c.id=s.carrier_id WHERE i.batch_id=${batch}`;
    } else {
      const { rows: list } = await shipmentList(user, filters, true);
      rows = list.map((s) => ({
        "Mã vận đơn": s.tracking_code,
        "Mã đơn hàng": s.external_id,
        Sàn: s.channel,
        Shop: s.shop,
        Hãng: s.carrier,
        Kho: s.warehouse,
        "Ngày cần xuất": s.due_date,
        "Trạng thái": statuses[s.status],
        "Thời gian quét UTC": s.scanned_at,
        "Nhân viên quét": s.employee,
        "Thời gian bàn giao UTC": s.handed_at,
        "Người bàn giao": s.handover_employee,
        Ca: s.shift,
        "Ghi chú": s.note,
      }));
    }
    return exportData(
      rows,
      req.nextUrl.searchParams.get("format") ?? "xlsx",
      "comsflow-report",
    );
  }
  if (path === "shifts/start-self" && req.method === "POST")
    return json(await startOwnShift(user, (await body(req)).warehouseId));
  if (path === "shifts/assign" && req.method === "POST")
    return json(await assignShift(user, await body(req)));
  if (path === "shifts" && req.method === "POST") {
    const d = z
      .object({
        name: z.string().min(2).max(100),
        warehouseId: warehouseIdSchema,
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }),
        members: z.array(z.uuid()).min(1).max(500),
      })
      .parse(await body(req));
    if (new Date(d.endsAt) <= new Date(d.startsAt))
      throw new AppError(400, "Thời gian kết thúc phải sau bắt đầu");
    return json(
      await sql.begin(async (tx) => {
        if (
          !(await tx`SELECT id FROM warehouses WHERE id=${d.warehouseId}`)
            .length
        )
          throw new AppError(
            404,
            "Kho không còn tồn tại. Tải lại danh mục rồi chọn kho.",
          );
        const active =
          await tx`SELECT id FROM users WHERE id IN ${tx([...new Set(d.members)])} AND active`;
        if (active.length !== new Set(d.members).size)
          throw new AppError(400, "Chỉ phân công tài khoản đang hoạt động");
        const [shift] =
          await tx`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES(${d.name},${d.warehouseId},${d.startsAt},${d.endsAt}) RETURNING *`;
        for (const member of new Set(d.members))
          await tx`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift.id},${member})`;
        await audit(
          tx,
          user,
          "shift_create",
          shift.id,
          null,
          { ...shift, members: d.members },
          "Tạo ca và phân công nhân viên",
        );
        return shift;
      }),
    );
  }
  if (path === "audit" && req.method === "GET")
    return json(
      await sql`SELECT a.*,u.name employee FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200`,
    );
  requireRole(user, ["admin"]);
  if (path === "config/setup" && req.method === "POST")
    return json(await setupCatalogs(user));
  if (path === "maintenance/storage" && req.method === "GET")
    return json(await storageInfo(user));
  if (path === "maintenance/preview" && req.method === "POST")
    return json(await previewCleanup(user, await body(req)));
  if (path === "maintenance/execute" && req.method === "POST") {
    try {
      return json(await executeCleanup(user, await body(req)));
    } catch (error) {
      if (
        ["55P03", "57014", "40P01", "40001"].includes(
          (error as { code?: string }).code ?? "",
        )
      )
        throw new AppError(
          503,
          "Chưa thể xác nhận hoàn tất khi kho đang bận hoặc lần dọn quá lâu. Thử lại cùng lần xem trước để nhận kết quả.",
        );
      throw error;
    }
  }
  if (path === "maintenance/optimize" && req.method === "POST")
    return json(await optimizeStorage(user));
  if (/^maintenance\/export\/[^/]+$/.test(path) && req.method === "GET")
    return exportData(
      await cleanupExport(user, id(path.split("/")[2])),
      req.nextUrl.searchParams.get("format") ?? "xlsx",
      "danh-sach-du-kien-xoa",
    );
  if (path === "users" && req.method === "POST") {
    const d = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z.email().max(200),
        password: z.string().min(12).max(100),
        role: z.enum(["admin", "manager", "staff"]),
      })
      .parse(await body(req));
    const account = await createAccount(d);
    await audit(
      sql as any,
      user,
      "user_create",
      account.id,
      null,
      account,
      "Tạo tài khoản Supabase",
    );
    return json(account);
  }
  if (path === "users/update" && req.method === "POST") {
    const d = z
      .object({
        id: z.uuid(),
        active: z.boolean().optional(),
        role: z.enum(["admin", "manager", "staff"]).optional(),
        reason: z.string().trim().min(8).max(1000),
      })
      .refine(
        (d) => d.active !== undefined || d.role !== undefined,
        "Chọn quyền hoặc trạng thái cần cập nhật",
      )
      .parse(await body(req));
    if (d.id === user.id)
      throw new AppError(
        400,
        "Không được tự khóa hoặc thay đổi vai trò của mình",
      );
    return json(
      await sql.begin(async (tx) => {
        const [before] =
          await tx`SELECT id,name,role,active FROM users WHERE id=${d.id} FOR UPDATE`;
        if (!before) throw new AppError(404, "Không tìm thấy tài khoản");
        const [after] =
          await tx`UPDATE users SET role=${d.role ?? before.role},active=${d.active ?? before.active} WHERE id=${d.id} RETURNING id,name,role,active`;
        await tx`DELETE FROM sessions WHERE user_id=${d.id}`;
        await audit(tx, user, "user_update", d.id, before, after, d.reason);
        return after;
      }),
    );
  }
  if (path === "config" && req.method === "POST") {
    const input = z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.enum(["carrier", "warehouse", "channel"]),
          name: z.string().trim().min(2).max(100),
        }),
        z.object({
          kind: z.literal("rule"),
          prefix: z.string().regex(/^[A-Z0-9]{1,30}$/),
          carrierId: z.uuid(),
          channelId: z.union([z.uuid(), z.literal("")]),
          active: z.boolean().default(true),
        }),
        z.object({
          kind: z.literal("carrier-rename"),
          id: z.uuid(),
          name: z.string().trim().min(2).max(100),
        }),
        z.object({
          kind: z.literal("settings"),
          cutoffHour: z.number().int().min(0).max(23),
        }),
      ])
      .parse(await body(req));
    return json(
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(742920)`;
        let result, before;
        if (input.kind === "rule") {
          [before] =
            await tx`SELECT * FROM carrier_matching_rules WHERE prefix=${input.prefix}`;
          [result] =
            await tx`INSERT INTO carrier_matching_rules(prefix,carrier_id,channel_id,active) VALUES(${input.prefix},${input.carrierId},${input.channelId || null},${input.active}) ON CONFLICT(prefix) DO UPDATE SET carrier_id=excluded.carrier_id,channel_id=excluded.channel_id,active=excluded.active RETURNING *`;
        } else if (input.kind === "carrier-rename") {
          [before] =
            await tx`SELECT * FROM shipping_carriers WHERE id=${input.id}`;
          if (!before) throw new AppError(404, "Hãng không tồn tại");
          const normalized = carrierKey(input.name);
          if (
            (
              await tx`SELECT carrier_id FROM carrier_aliases WHERE alias=${normalized} AND carrier_id<>${input.id}`
            ).length
          )
            throw new AppError(
              409,
              "Tên chuẩn trùng tên gọi của một hãng khác",
            );
          if (
            (
              await tx`SELECT name,id FROM shipping_carriers WHERE id<>${input.id}`
            ).some((c) => carrierKey(c.name) === normalized)
          )
            throw new AppError(409, "Tên chuẩn trùng một hãng đã có");
          [result] =
            await tx`UPDATE shipping_carriers SET name=${input.name} WHERE id=${input.id} RETURNING *`;
          await tx`INSERT INTO carrier_aliases(alias,carrier_id) VALUES(${carrierKey(before.name)},${input.id}) ON CONFLICT(alias) DO UPDATE SET carrier_id=excluded.carrier_id`;
        } else if (input.kind === "settings") {
          [before] =
            await tx`SELECT * FROM system_settings WHERE key='cutoff_hour'`;
          [result] =
            await tx`INSERT INTO system_settings(key,value) VALUES('cutoff_hour',${tx.json(input.cutoffHour)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value RETURNING *`;
        } else {
          if (input.kind === "carrier") {
            const existing = identifyCarrier(
              await carrierCatalog(tx),
              "",
              input.name,
            );
            if (existing.carrierId) {
              const [canonical] =
                await tx`SELECT * FROM shipping_carriers WHERE id=${existing.carrierId}`;
              return canonical;
            }
          }
          const table = {
            carrier: "shipping_carriers",
            warehouse: "warehouses",
            channel: "sales_channels",
          }[input.kind];
          [before] =
            await tx`SELECT * FROM ${tx(table)} WHERE name=${input.name}`;
          [result] =
            await tx`INSERT INTO ${tx(table)}(name) VALUES(${input.name}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING *`;
        }
        await audit(
          tx,
          user,
          "config_update",
          result.id ?? result.key,
          before ?? null,
          result,
          "Cập nhật cấu hình",
        );
        return result;
      }),
    );
  }
  throw new AppError(404, "Không tìm thấy API");
}
export async function handler(req: NextRequest) {
  try {
    return await dispatch(req);
  } catch (error) {
    if (error instanceof AppError) {
      const response = json({ error: error.message }, error.status);
      if (error.status === 503) response.headers.set("Retry-After", "5");
      return response;
    }
    if (error instanceof z.ZodError)
      return json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    if (error instanceof SyntaxError)
      return json({ error: "Dữ liệu JSON không hợp lệ" }, 400);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    )
      return json({ error: "Dữ liệu đã tồn tại, vui lòng kiểm tra lại" }, 409);
    console.error(
      "API error",
      error && typeof error === "object" && "code" in error
        ? error.code
        : "UNEXPECTED",
    );
    return json(
      {
        error:
          "Không thể xử lý yêu cầu. Kiểm tra kết nối database hoặc nhật ký máy chủ.",
      },
      500,
    );
  }
}
export { handler as GET, handler as POST };
