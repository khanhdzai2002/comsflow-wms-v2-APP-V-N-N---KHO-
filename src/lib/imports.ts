import {
  lockTrackingCodes,
  reconcilePrescans,
  requirePrescanSchema,
} from "./prescan";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { db, audit, type User } from "./db";
import {
  AppError,
  normalizeCode,
  validCode,
  managerRoles,
  requireRole,
} from "./domain";
import { fields, fieldLabels } from "./import-fields";
import { checkXlsxSize, checkXlsxInflation } from "./xlsx-safety";
export { fields, fieldLabels } from "./import-fields";
export type Mapping = Record<string, string>;
const rowSchema = z.object({
  tracking_code: z.string().refine(validCode, "Mã vận đơn không hợp lệ"),
  order_id: z.string().min(1).max(150),
  channel: z.string().min(1).max(100),
  shop: z.string().min(1).max(100),
  carrier: z.string().min(1).max(100),
  due_date: z.iso.date(),
  status: z.enum(["pending", "awaiting_scan", "cancelled", "blocked"]),
  sku: z.string().min(1).max(100),
  product_name: z.string().min(1).max(300),
  color: z.string().max(100),
  size: z.string().max(100),
  quantity: z.coerce.number().int().min(1).max(100000),
  warehouse: z.string().min(1).max(100),
});
export type ImportRow = z.infer<typeof rowSchema>;
export type ParsedFile = { headers: string[]; rows: Record<string, string>[] };
export async function parseFile(
  buffer: Buffer,
  filename: string,
): Promise<ParsedFile> {
  if (buffer.length > 5 * 1024 * 1024)
    throw new AppError(400, "File tối đa 5 MB");
  const ext = filename.toLowerCase().split(".").pop();
  let matrix: string[][] = [];
  if (ext === "csv")
    matrix = parse(buffer.toString("utf8").replace(/^\uFEFF/, ""), {
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: 32768,
    });
  else if (ext === "xlsx") {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
      throw new AppError(400, "File XLSX không hợp lệ");
    // Streaming reader limits inflated XML consumption; formulas are never evaluated.
    const { Readable } = await import("node:stream");
    const { default: ExcelJS } = await import("exceljs");
    checkXlsxSize(buffer);
    await checkXlsxInflation(buffer);
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(
      Readable.from(buffer),
      { sharedStrings: "cache", hyperlinks: "ignore", styles: "cache" },
    );
    let cells = 0;
    for await (const sheet of reader) {
      for await (const row of sheet) {
        if (matrix.length >= 10001 || row.cellCount > 80)
          throw new AppError(400, "Tối đa 10.000 dòng và 80 cột");
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cells += cell.text.length;
          if (cells > 10_000_000)
            throw new AppError(400, "Dữ liệu giải nén quá lớn");
          if (cell.type === ExcelJS.ValueType.Formula)
            throw new AppError(
              400,
              "Hãy chuyển công thức thành giá trị trước khi nhập",
            );
          const value = cell.value;
          values[col - 1] =
            value instanceof Date
              ? value.toISOString().slice(0, 10)
              : cell.text;
        });
        matrix.push(values);
      }
      break;
    }
  } else throw new AppError(400, "Chỉ hỗ trợ CSV hoặc XLSX");
  if (matrix.length < 2 || matrix.length > 10001)
    throw new AppError(400, "File phải có tiêu đề và từ 1 đến 10.000 dòng");
  const headers = matrix[0].map((v) => String(v ?? "").trim());
  if (
    headers.length > 80 ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !h)
  )
    throw new AppError(
      400,
      "Tiêu đề cột phải duy nhất, không trống, tối đa 80 cột",
    );
  return {
    headers,
    rows: matrix
      .slice(1)
      .map((row) =>
        Object.fromEntries(
          headers.map((h, i) => [h, String(row[i] ?? "").trim()]),
        ),
      ),
  };
}
export function validateRows(rows: Record<string, string>[], mapping: Mapping) {
  const valid: { row: number; data: ImportRow }[] = [],
    errors: { row: number; message: string; raw: Record<string, string> }[] =
      [];
  const invalidOrders = new Set<string>();
  const key = (d: Record<string, unknown>) =>
    JSON.stringify([d.channel, d.shop, d.order_id]);
  rows.forEach((raw, index) => {
    const mapped = Object.fromEntries(
      fields.map((f) => [f, raw[mapping[f] ?? f] ?? ""]),
    );
    mapped.tracking_code = normalizeCode(mapped.tracking_code);
    mapped.status ||= "awaiting_scan";
    const result = rowSchema.safeParse(mapped);
    if (result.success) valid.push({ row: index + 2, data: result.data });
    else {
      errors.push({
        row: index + 2,
        message: result.error.issues
          .map(
            (i) =>
              `${fieldLabels[String(i.path[0])] ?? i.path[0]}: ${i.message}`,
          )
          .join("; "),
        raw,
      });
      invalidOrders.add(key(mapped));
    }
  });
  // Every line of an order/parcel must agree; reject whole conflicting groups.
  const conflicts = new Set<string>(),
    parcel = new Map<string, ImportRow>(),
    order = new Map<string, string>();
  for (const { data: d } of valid) {
    const prev = parcel.get(d.tracking_code);
    if (
      prev &&
      (key(prev) !== key(d) ||
        ["carrier", "warehouse", "due_date", "status"].some(
          (k) => prev[k as keyof ImportRow] !== d[k as keyof ImportRow],
        ))
    ) {
      conflicts.add(key(d));
      conflicts.add(key(prev));
    }
    parcel.set(d.tracking_code, d);
    const signature = JSON.stringify([d.warehouse, d.channel, d.shop]);
    const pk = key(d);
    if (order.has(pk) && order.get(pk) !== signature) conflicts.add(pk);
    order.set(pk, signature);
  }
  return {
    valid: valid.filter(({ row, data }) => {
      if (conflicts.has(key(data)) || invalidOrders.has(key(data))) {
        errors.push({
          row,
          message:
            "Đơn có dòng lỗi hoặc các dòng cùng đơn/kiện có thông tin mâu thuẫn; không nhập một phần đơn",
          raw: rows[row - 2],
        });
        return false;
      }
      return true;
    }),
    errors,
  };
}
export async function importRows(
  user: User,
  filename: string,
  rows: Record<string, string>[],
  mapping: Mapping,
) {
  requireRole(user, managerRoles);
  if (rows.length > 10000) throw new AppError(400, "Tối đa 10.000 dòng");
  await requirePrescanSchema(db());
  const checked = validateRows(rows, mapping);
  return db().begin(async (tx) => {
    // Imports are infrequent; serialize them to avoid cross-batch item races.
    await tx`SELECT pg_advisory_xact_lock(742918)`;
    await lockTrackingCodes(
      tx,
      checked.valid.map((r) => r.data.tracking_code),
    );
    const [batch] =
      await tx`INSERT INTO import_batches(filename,user_id,total_rows) VALUES(${filename},${user.id},${rows.length}) RETURNING *`;
    const groups = new Map<string, typeof checked.valid>();
    for (const row of checked.valid) {
      const d = row.data,
        k = JSON.stringify([d.channel, d.shop, d.order_id]);
      groups.set(k, [...(groups.get(k) ?? []), row]);
    }
    let imported = 0,
      newShipments = 0,
      updatedShipments = 0,
      orders = 0,
      reconciledScans = 0,
      reconciledDuplicates = 0;
    for (const group of groups.values()) {
      try {
        await tx.savepoint(async (sp) => {
          const d = group[0].data;
          const [channel] =
            await sp`INSERT INTO sales_channels(name) VALUES(${d.channel}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
          const [shop] =
            await sp`INSERT INTO shops(name,channel_id) VALUES(${d.shop},${channel.id}) ON CONFLICT(channel_id,name) DO UPDATE SET name=excluded.name RETURNING id`;
          const [order] =
            await sp`INSERT INTO orders(external_id,channel_id,shop_id) VALUES(${d.order_id},${channel.id},${shop.id}) ON CONFLICT(shop_id,external_id) DO UPDATE SET external_id=excluded.external_id RETURNING id`;
          const sourceCodes = new Set(group.map((r) => r.data.tracking_code));
          const existingParcels =
            await sp`SELECT tracking_code FROM shipments WHERE order_id=${order.id}`;
          if (existingParcels.some((s) => !sourceCodes.has(s.tracking_code)))
            throw new Error(
              "File thiếu kiện của đơn đã tồn tại. Nhập đầy đủ mọi kiện và sản phẩm của đơn để tránh cập nhật một phần.",
            );
          const seen = new Set<string>();
          let created = 0,
            updated = 0;
          for (const { data: r } of group) {
            if (seen.has(r.tracking_code)) continue;
            seen.add(r.tracking_code);
            const [warehouse] =
              await sp`INSERT INTO warehouses(name) VALUES(${r.warehouse}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
            const [carrier] =
              await sp`INSERT INTO shipping_carriers(name) VALUES(${r.carrier}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
            const [existing] =
              await sp`SELECT * FROM shipments WHERE tracking_code=${r.tracking_code} FOR UPDATE`;
            if (existing) {
              if (existing.order_id !== order.id)
                throw new Error("Mã vận đơn đã thuộc đơn khác");
              if (
                existing.scanned_at &&
                (existing.carrier_id !== carrier.id ||
                  existing.warehouse_id !== warehouse.id ||
                  ["cancelled", "blocked"].includes(r.status))
              )
                throw new Error(
                  "Đơn đã quét: thay đổi hãng/kho hoặc hủy phải xử lý ngoại lệ có lý do",
                );
              const [after] =
                await sp`UPDATE shipments SET due_date=${r.due_date},carrier_id=${carrier.id},warehouse_id=${warehouse.id},status=${existing.scanned_at ? existing.status : r.status},updated_at=now() WHERE id=${existing.id} RETURNING *`;
              await audit(
                sp,
                user,
                "import_update",
                existing.id,
                existing,
                after,
                `Nhập lại từ ${filename}`,
              );
              updated++;
            } else {
              const [s] =
                await sp`INSERT INTO shipments(tracking_code,order_id,carrier_id,warehouse_id,due_date,status) VALUES(${r.tracking_code},${order.id},${carrier.id},${warehouse.id},${r.due_date},${r.status}) RETURNING id`;
              await audit(
                sp,
                user,
                "import_create",
                s.id,
                null,
                r,
                `Nhập từ ${filename}`,
              );
              created++;
            }
          }
          // A file is an order-item snapshot for orders it contains. Reimport replaces
          // quantities rather than accumulating them; scan/handover history is untouched.
          const items = new Map<string, ImportRow>();
          for (const { data: r } of group) {
            const k = JSON.stringify([r.sku, r.color, r.size]);
            const prev = items.get(k);
            items.set(k, {
              ...r,
              quantity: (prev?.quantity ?? 0) + r.quantity,
            });
          }
          const before =
            await sp`SELECT * FROM order_items WHERE order_id=${order.id}`;
          await sp`DELETE FROM order_items WHERE order_id=${order.id}`;
          for (const item of items.values())
            await sp`INSERT INTO order_items(order_id,sku,name,color,size,quantity) VALUES(${order.id},${item.sku},${item.product_name},${item.color},${item.size},${item.quantity})`;
          await audit(
            sp,
            user,
            "import_items",
            order.id,
            before,
            [...items.values()],
            `Ảnh chụp danh sách sản phẩm từ ${filename}`,
          );
          const reconciliation = await reconcilePrescans(sp, user, [
            ...sourceCodes,
          ]);
          reconciledScans += reconciliation.matched;
          reconciledDuplicates += reconciliation.duplicates;
          imported += group.length;
          newShipments += created;
          updatedShipments += updated;
          orders++;
        });
      } catch (error) {
        for (const row of group)
          checked.errors.push({
            row: row.row,
            message:
              error instanceof Error ? error.message : "Không thể nhập đơn",
            raw: rows[row.row - 2],
          });
      }
    }
    for (const err of checked.errors)
      await tx`INSERT INTO import_errors(batch_id,row_number,message,raw) VALUES(${batch.id},${err.row},${err.message},${tx.json(err.raw)})`;
    await tx`UPDATE import_batches SET imported=${imported},errors=${checked.errors.length} WHERE id=${batch.id}`;
    await audit(
      tx,
      user,
      "import_batch",
      batch.id,
      null,
      {
        imported,
        newShipments,
        updatedShipments,
        orders,
        errors: checked.errors.length,
      },
      filename,
    );
    return {
      reconciledScans,
      reconciledDuplicates,
      batchId: batch.id,
      total: rows.length,
      imported,
      newShipments,
      updatedShipments,
      orders,
      errors: checked.errors,
    };
  });
}
