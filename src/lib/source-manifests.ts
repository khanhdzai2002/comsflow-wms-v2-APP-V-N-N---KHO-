import { warehouseIdSchema } from "./domain";
import { z } from "zod";
import { db, audit, type User, type Tx } from "./db";
import { AppError, requireRole, managerRoles } from "./domain";
import { canonicalSourceCarrier } from "./source-carriers";
import type { SourcePdf } from "./pdf-labels";

export const sourceContextSchema = z.object({
  warehouseId: warehouseIdSchema,
  carrierId: z.union([z.uuid(), z.literal("")]).default(""),
  channel: z.string().trim().max(100).default(""),
  shop: z.string().trim().min(1).max(100),
  dueDate: z.iso.date(),
});
type Context = z.infer<typeof sourceContextSchema>;
async function resolveContext(
  tx: ReturnType<typeof db> | Tx,
  pdf: SourcePdf,
  raw: unknown,
): Promise<Context> {
  const c = sourceContextSchema.parse(raw);
  const detected =
    pdf.detectedCarriers.length === 1 ? pdf.detectedCarriers[0] : null;
  const detectedChannel =
    pdf.detectedChannels.length === 1 ? pdf.detectedChannels[0] : null;
  if (!detectedChannel)
    throw new AppError(
      400,
      "Chưa nhận dạng duy nhất một sàn trong PDF; xem lỗi từng trang.",
    );
  if (c.channel && c.channel !== detectedChannel)
    throw new AppError(
      400,
      `Nội dung PDF nhận dạng sàn ${detectedChannel}, nhưng bạn chọn ${c.channel}. Chọn Tự nhận dạng hoặc đúng sàn.`,
    );
  c.channel = detectedChannel;
  if (!c.carrierId) {
    if (!detected)
      throw new AppError(
        400,
        "Chưa nhận dạng duy nhất một hãng trong PDF; xem lỗi từng trang.",
      );
    const [carrier] =
      await tx`SELECT id FROM shipping_carriers WHERE lower(name)=lower(${detected})`;
    if (!carrier)
      throw new AppError(
        400,
        `Chưa có hãng ${detected}. Quản trị viên cần bổ sung tại Cấu hình hệ thống.`,
      );
    c.carrierId = carrier.id;
  }
  const [warehouse] =
    await tx`SELECT id FROM warehouses WHERE id=${c.warehouseId}`;
  const [carrier] =
    await tx`SELECT id,name FROM shipping_carriers WHERE id=${c.carrierId}`;
  if (!warehouse || !carrier)
    throw new AppError(400, "Kho hoặc hãng không tồn tại");
  const selected = canonicalSourceCarrier(carrier.name);
  if (
    !selected ||
    (c.channel === "Shopee"
      ? !["SPX Express", "GHN"].includes(selected)
      : !["J&T Express", "BEST Express"].includes(selected))
  )
    throw new AppError(
      400,
      "PDF hiện hỗ trợ Shopee/SPX Express/GHN và TikTok Shop/J&T Express/BEST Express; mẫu khác dùng CSV/XLSX.",
    );
  if (detected && selected !== detected)
    throw new AppError(
      400,
      `Nội dung PDF nhận dạng ${detected}, nhưng bạn chọn ${carrier.name}. Chọn Tự nhận dạng hoặc đúng hãng; không lưu sai hãng.`,
    );
  return c;
}
async function existingRows(tx: ReturnType<typeof db> | Tx, pdf: SourcePdf) {
  const codes = pdf.labels.map((l) => l.trackingCode);
  return codes.length
    ? tx`SELECT s.*,to_char(s.due_date,'YYYY-MM-DD') due_date,o.external_id,sh.name shop,c.name channel FROM shipments s JOIN orders o ON o.id=s.order_id JOIN shops sh ON sh.id=o.shop_id JOIN sales_channels c ON c.id=o.channel_id WHERE s.tracking_code IN ${tx(codes)}`
    : [];
}
function conflicts(
  rows: Awaited<ReturnType<typeof existingRows>>,
  pdf: SourcePdf,
  c: Context,
) {
  const codes = new Map(pdf.labels.map((l) => [l.trackingCode, l.orderId]));
  return rows
    .filter(
      (r) =>
        r.external_id !== codes.get(r.tracking_code) ||
        r.warehouse_id !== c.warehouseId ||
        r.carrier_id !== c.carrierId ||
        r.channel !== c.channel ||
        r.shop !== c.shop,
    )
    .map((r) => ({
      trackingCode: r.tracking_code,
      message:
        "Đã có trong hệ thống nhưng khác mã đơn, kho, hãng, sàn hoặc shop. Kiểm tra nguồn trước khi lưu.",
    }));
}
export async function previewSource(user: User, pdf: SourcePdf, raw: unknown) {
  requireRole(user, managerRoles);
  const sql = db();
  sourceContextSchema.parse(raw);
  if (pdf.detectedCarriers.length !== 1 || pdf.detectedChannels.length !== 1)
    return {
      ...pdf,
      uniqueShipments: pdf.labels.length,
      existingShipments: 0,
      alreadyScanned: 0,
      alreadyHanded: 0,
      differentDueDates: 0,
      conflicts: [],
      existingManifestId: null,
      existingManifestArchived: false,
      carrierUnresolved: true,
      channelName: null,
      carrierName: null,
      carrierId: null,
    };
  const c = await resolveContext(sql, pdf, raw);
  const existing = await existingRows(sql, pdf);
  const [batch] =
    await sql`SELECT m.id,a.archived_at FROM source_manifests m LEFT JOIN source_manifest_archives a ON a.manifest_id=m.id WHERE m.file_hash=${pdf.hash}`;
  return {
    ...pdf,
    channelName: c.channel,
    carrierName: pdf.detectedCarriers[0],
    carrierId: c.carrierId,
    carrierUnresolved: false,
    uniqueShipments: pdf.labels.length,
    existingShipments: existing.length,
    alreadyScanned: existing.filter((r) => r.scanned_at).length,
    alreadyHanded: existing.filter((r) => r.handed_at).length,
    differentDueDates: existing.filter(
      (r) => String(r.due_date).slice(0, 10) !== c.dueDate,
    ).length,
    conflicts: conflicts(existing, pdf, c),
    existingManifestId: batch?.id ?? null,
    existingManifestArchived: !!batch?.archived_at,
  };
}
export async function commitSource(
  user: User,
  filename: string,
  pdf: SourcePdf,
  raw: unknown,
) {
  requireRole(user, managerRoles);
  sourceContextSchema.parse(raw);
  if (pdf.errors.length || !pdf.labels.length)
    throw new AppError(
      400,
      "PDF còn trang lỗi hoặc không có vận đơn. Không lưu một phần file nguồn; kiểm tra lại tất cả trang.",
    );
  return db().begin(async (tx) => {
    // Same lock as CSV/XLSX: global tracking identity cannot race across import types.
    await tx`SELECT pg_advisory_xact_lock(742918)`;
    const c = await resolveContext(tx, pdf, raw);
    const [old] =
      await tx`SELECT m.*,to_char(m.due_date,'YYYY-MM-DD') due_date,s.name shop,c.name channel,a.archived_at FROM source_manifests m LEFT JOIN source_manifest_archives a ON a.manifest_id=m.id JOIN shops s ON s.id=m.shop_id JOIN sales_channels c ON c.id=s.channel_id WHERE m.file_hash=${pdf.hash}`;
    if (old) {
      if (old.archived_at)
        throw new AppError(
          409,
          "File này đã bị loại bỏ. Vào Đối soát xuất kho → Theo file nguồn PDF → Nguồn đã loại bỏ để khôi phục; không tạo nguồn trùng.",
        );
      if (
        old.warehouse_id !== c.warehouseId ||
        old.carrier_id !== c.carrierId ||
        old.shop !== c.shop ||
        old.channel !== c.channel ||
        String(old.due_date).slice(0, 10) !== c.dueDate
      )
        throw new AppError(
          409,
          "File này đã lưu với thông tin nguồn khác. Mở danh sách nguồn cũ để kiểm tra; không tạo bản trùng.",
        );
      return {
        id: old.id,
        reused: true,
        total: pdf.labels.length,
        newShipments: 0,
      };
    }
    // Match handover's UUID lock order to avoid deadlocks with concurrent confirmations.
    const codes = pdf.labels.map((l) => l.trackingCode);
    await tx`SELECT id FROM shipments WHERE tracking_code IN ${tx(codes)} ORDER BY id FOR UPDATE`;
    const existing = await existingRows(tx, pdf),
      issues = conflicts(existing, pdf, c);
    if (issues.length)
      throw new AppError(
        409,
        `Không lưu: ${issues.length} mã xung đột, ví dụ ${issues[0].trackingCode}. Xem trước để kiểm tra.`,
      );
    const [channel] =
      await tx`INSERT INTO sales_channels(name) VALUES(${c.channel}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
    const [shop] =
      await tx`INSERT INTO shops(name,channel_id) VALUES(${c.shop},${channel.id}) ON CONFLICT(channel_id,name) DO UPDATE SET name=excluded.name RETURNING id`;
    const [manifest] =
      await tx`INSERT INTO source_manifests(filename,file_hash,warehouse_id,carrier_id,shop_id,due_date,page_count,duplicate_pages,continuation_pages,created_by)
      VALUES(${filename.slice(0, 255)},${pdf.hash},${c.warehouseId},${c.carrierId},${shop.id},${c.dueDate},${pdf.pageCount},${pdf.duplicatePages},${pdf.continuationPages},${user.id}) RETURNING id`;
    const byCode = new Map(
      existing.map((shipment) => [shipment.tracking_code, shipment]),
    );
    const newLabels = pdf.labels.filter(
      (label) => !byCode.has(label.trackingCode),
    );
    let created = 0;
    if (newLabels.length) {
      // A file can contain thousands of parcels. Bulk writes avoid a network round trip per parcel.
      const orderIds = [
        ...new Set(newLabels.map((label) => label.orderId)),
      ].sort();
      const orders = await tx`INSERT INTO orders ${tx(
        orderIds.map((external_id) => ({
          external_id,
          channel_id: channel.id,
          shop_id: shop.id,
        })),
        "external_id",
        "channel_id",
        "shop_id",
      )}
        ON CONFLICT(shop_id,external_id) DO UPDATE SET external_id=excluded.external_id RETURNING id,external_id`;
      const byExternal = new Map(
        orders.map((order) => [order.external_id, order.id]),
      );
      const shipments = await tx`INSERT INTO shipments ${tx(
        newLabels.map((label) => ({
          tracking_code: label.trackingCode,
          order_id: byExternal.get(label.orderId),
          carrier_id: c.carrierId,
          warehouse_id: c.warehouseId,
          due_date: c.dueDate,
          note: "Nguồn tem PDF: chưa nhập chi tiết SKU/sản phẩm; bổ sung bằng CSV/XLSX khi cần.",
        })),
        "tracking_code",
        "order_id",
        "carrier_id",
        "warehouse_id",
        "due_date",
        "note",
      )} RETURNING *`;
      created = shipments.length;
      for (const shipment of shipments)
        byCode.set(shipment.tracking_code, shipment);
    }
    await tx`INSERT INTO source_manifest_items ${tx(
      pdf.labels.map((label) => {
        const shipment = byCode.get(label.trackingCode)!;
        return {
          manifest_id: manifest.id,
          shipment_id: shipment.id,
          tracking_code: label.trackingCode,
          external_id: label.orderId,
          pages: tx.array(label.pages, 23),
          scanned_before_import: !!shipment.scanned_at,
          handed_before_import: !!shipment.handed_at,
        };
      }),
      "manifest_id",
      "shipment_id",
      "tracking_code",
      "external_id",
      "pages",
      "scanned_before_import",
      "handed_before_import",
    )}`;
    await audit(
      tx,
      user,
      "source_manifest_import",
      manifest.id,
      null,
      {
        filename,
        carrier: pdf.detectedCarriers[0],
        hash: pdf.hash,
        shipments: pdf.labels.length,
        orders: pdf.orderCount,
        pages: pdf.pageCount,
        duplicatePages: pdf.duplicatePages,
        continuationPages: pdf.continuationPages,
      },
      "Lưu danh sách nguồn PDF; đếm mỗi mã vận đơn một lần, giữ nguyên lịch sử hiện có",
    );
    return {
      id: manifest.id,
      reused: false,
      total: pdf.labels.length,
      newShipments: created,
    };
  });
}
export async function sourceReport(user: User, manifestId: string) {
  requireRole(user, managerRoles);
  const id = z.uuid().parse(manifestId),
    sql = db();
  // One SQL snapshot prevents counters and rows disagreeing while another employee scans.
  const rows =
    await sql`SELECT i.*,s.status,s.scanned_at,s.handed_at,s.due_date current_due_date,s.warehouse_id current_warehouse_id,s.carrier_id current_carrier_id,
    w.name warehouse,ca.name carrier FROM source_manifest_items i JOIN shipments s ON s.id=i.shipment_id
    JOIN warehouses w ON w.id=s.warehouse_id JOIN shipping_carriers ca ON ca.id=s.carrier_id WHERE i.manifest_id=${id} ORDER BY i.pages[1],i.tracking_code`;
  const [manifest] =
    await sql`SELECT m.*,to_char(m.due_date,'YYYY-MM-DD') due_date,w.name warehouse,c.name carrier,sh.name shop,sc.name channel,u.name employee,a.archived_at,a.reason archive_reason,au.name archived_by_name
    FROM source_manifests m LEFT JOIN source_manifest_archives a ON a.manifest_id=m.id LEFT JOIN users au ON au.id=a.archived_by JOIN warehouses w ON w.id=m.warehouse_id JOIN shipping_carriers c ON c.id=m.carrier_id
    JOIN shops sh ON sh.id=m.shop_id JOIN sales_channels sc ON sc.id=sh.channel_id JOIN users u ON u.id=m.created_by WHERE m.id=${id}`;
  if (!manifest) throw new AppError(404, "Không tìm thấy danh sách nguồn");
  const items: (Record<string, any> & { contextChanged: boolean })[] = rows.map(
    (r) => ({
      ...r,
      contextChanged:
        r.current_warehouse_id !== manifest.warehouse_id ||
        r.current_carrier_id !== manifest.carrier_id,
    }),
  );
  const scanned = items.filter((r) => r.scanned_at).length;
  const handed = items.filter(
    (r) => r.handed_at && r.status === "handed_over" && !r.contextChanged,
  ).length;
  const exceptions = items.filter(
    (r) =>
      ["cancelled", "blocked", "review"].includes(r.status) || r.contextChanged,
  ).length;
  return {
    manifest,
    rows: items,
    totals: {
      expected: items.length,
      orders: new Set(items.map((r) => r.external_id)).size,
      scanned,
      unscanned: items.length - scanned,
      handed,
      notHanded: items.length - handed,
      exceptions,
      scannedBeforeImport: items.filter((r) => r.scanned_before_import).length,
      handedBeforeImport: items.filter((r) => r.handed_before_import).length,
      scanComplete:
        !manifest.archived_at &&
        items.length > 0 &&
        scanned === items.length &&
        exceptions === 0,
      complete:
        !manifest.archived_at &&
        items.length > 0 &&
        handed === items.length &&
        exceptions === 0,
    },
  };
}
export async function listSources(user: User, archived = false) {
  requireRole(user, managerRoles);
  return db()`SELECT m.*,to_char(m.due_date,'YYYY-MM-DD') due_date,w.name warehouse,c.name carrier,sh.name shop,sc.name channel,a.archived_at,a.reason archive_reason,count(i.shipment_id)::int expected,
    count(DISTINCT i.external_id)::int orders
    FROM source_manifests m LEFT JOIN source_manifest_archives a ON a.manifest_id=m.id JOIN warehouses w ON w.id=m.warehouse_id JOIN shipping_carriers c ON c.id=m.carrier_id
    JOIN shops sh ON sh.id=m.shop_id JOIN sales_channels sc ON sc.id=sh.channel_id JOIN source_manifest_items i ON i.manifest_id=m.id
    WHERE (a.manifest_id IS NOT NULL) = ${archived}
    GROUP BY m.id,w.name,c.name,sh.name,sc.name,a.archived_at,a.reason ORDER BY m.created_at DESC LIMIT 100`;
}

export async function setSourceArchived(
  user: User,
  raw: unknown,
  archived: boolean,
) {
  requireRole(user, managerRoles);
  const input = z
    .object({ id: z.uuid(), reason: z.string().trim().min(8).max(1000) })
    .parse(raw);
  return db().begin(async (tx) => {
    // Serialize lifecycle changes with imports so an upload cannot silently undo removal.
    await tx`SELECT pg_advisory_xact_lock(742918)`;
    const [manifest] =
      await tx`SELECT id,filename FROM source_manifests WHERE id=${input.id} FOR UPDATE`;
    if (!manifest) throw new AppError(404, "Không tìm thấy danh sách nguồn");
    const [before] =
      await tx`SELECT * FROM source_manifest_archives WHERE manifest_id=${input.id}`;
    if (!!before === archived) return { id: input.id, archived, reused: true };
    let after = null;
    if (archived) {
      [after] =
        await tx`INSERT INTO source_manifest_archives(manifest_id,archived_by,reason) VALUES(${input.id},${user.id},${input.reason}) RETURNING *`;
    } else {
      await tx`DELETE FROM source_manifest_archives WHERE manifest_id=${input.id}`;
    }
    await audit(
      tx,
      user,
      archived ? "source_manifest_archive" : "source_manifest_restore",
      input.id,
      before ?? null,
      after,
      input.reason,
    );
    return { id: input.id, archived, reused: false };
  });
}
