import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { readXlsxTable, returnDate } from "./return-import";
import { db, audit, type User } from "./db";
import { AppError, managerRoles, requireRole } from "./domain";
export { salesFields, salesContextSchema } from "./sales-fields";
import { salesFields, salesContextSchema } from "./sales-fields";
export async function parseSalesFile(
  buffer: Buffer,
  filename: string,
  mapping: Record<string, string> = {},
  statuses = ["Completed", "Delivered", "Đã giao hàng", "Hoàn thành"],
) {
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw new AppError(400, "File bán hàng tối đa 5 MB");
  const matrix: string[][] = filename.toLowerCase().endsWith(".xlsx")
    ? await readXlsxTable(buffer)
    : filename.toLowerCase().endsWith(".csv")
      ? parse(buffer.toString("utf8").replace(/^\uFEFF/, ""), {
          skip_empty_lines: true,
          max_record_size: 32768,
        })
      : (() => {
          throw new AppError(400, "Chọn CSV/XLSX");
        })();
  const headers = Array.from(matrix[0] ?? [], (h) => String(h ?? "").trim()),
    fields = { ...salesFields, ...mapping };
  if (
    headers.length > 80 ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !h)
  )
    throw new AppError(400, "Tiêu đề trống hoặc trùng");
  for (const k of ["order", "sku", "quantity", "sold", "status"])
    if (!headers.includes(fields[k]))
      throw new AppError(400, "Thiếu cột " + fields[k] + ". Hãy ánh xạ cột.");
  if (matrix.length < 2 || matrix.length > 10001)
    throw new AppError(400, "Cần 1–10.000 dòng");
  const rows: any[] = [],
    errors: any[] = [],
    seen = new Set<string>();
  for (let index = 1; index < matrix.length; index++) {
    const raw = Object.fromEntries(
      headers.map((h, c) => [h, String(matrix[index]?.[c] ?? "").trim()]),
    );
    if (Object.values(raw).every((v) => !v)) continue;
    const get = (k: string) => raw[fields[k]] ?? "";
    try {
      const order = get("order"),
        sku = get("sku");
      if (
        [order, sku].some(
          (x) =>
            !x ||
            x.length > 100 ||
            !/^[A-Za-z0-9._-]+$/.test(x) ||
            /^\d+\.\d+E[+-]?\d+$/i.test(x),
        )
      )
        throw new Error("Mã đơn/SKU phải là text, không làm tròn/số khoa học");
      const quantity = Number(get("quantity"));
      if (!/^\d+$/.test(get("quantity")) || quantity < 1 || quantity > 100000)
        throw new Error("SL nguyên dương");
      const inputDate = get("sold"),
        sold = /^\d{4}-\d{2}-\d{2}$/.test(inputDate)
          ? z.iso.date().parse(inputDate)
          : new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Ho_Chi_Minh",
            }).format(new Date(returnDate(inputDate)));
      const color = get("color"),
        size = get("size"),
        line = get("line") || JSON.stringify([sku, color, size]);
      const key = JSON.stringify([order, line]);
      if (seen.has(key))
        throw new Error("Lặp dòng đơn/SKU; cần mã dòng riêng để phân biệt");
      seen.add(key);
      const status = get("status");
      if (!status) throw new Error("Thiếu trạng thái bán");
      rows.push({
        order,
        sku,
        line,
        color,
        size,
        quantity,
        sold,
        product: get("product"),
        successful: statuses.some(
          (s) => s.toLocaleLowerCase() === status.toLocaleLowerCase(),
        ),
        raw,
      });
    } catch (e) {
      errors.push({ row: index + 1, message: (e as Error).message });
    }
  }
  return {
    hash: createHash("sha256").update(buffer).digest("hex"),
    rows,
    errors,
    summary: {
      rows: rows.length,
      successful: rows.filter((r) => r.successful).length,
      interpretation: createHash("sha256")
        .update(
          JSON.stringify([fields, statuses.map((s) => s.toLowerCase()).sort()]),
        )
        .digest("hex"),
      quantity: rows
        .filter((r) => r.successful)
        .reduce((n, r) => n + r.quantity, 0),
    },
  };
}
export async function commitSales(
  user: User,
  file: Awaited<ReturnType<typeof parseSalesFile>>,
  filename: string,
  raw: unknown,
) {
  requireRole(user, managerRoles);
  const c = salesContextSchema.parse(raw);
  if (file.errors.length || !file.rows.length)
    throw new AppError(400, "Xử lý hết lỗi trước khi lưu nguồn bán");
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742920)`;
    const [channel] =
      await tx`INSERT INTO sales_channels(name) VALUES(${c.channel}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
    const [shop] =
      await tx`INSERT INTO shops(name,channel_id) VALUES(${c.shop},${channel.id}) ON CONFLICT(channel_id,name) DO UPDATE SET name=excluded.name RETURNING id`;
    const [prior] =
      await tx`SELECT id FROM sales_imports WHERE shop_id=${shop.id} AND file_hash=${file.hash}`;
    if (prior) {
      const [header] =
        await tx`SELECT summary FROM sales_imports WHERE id=${prior.id}`;
      if (header.summary.interpretation !== file.summary.interpretation)
        throw new AppError(
          409,
          "File đã nhập với ánh xạ/trạng thái khác. Kiểm tra và xuất bản dữ liệu mới trước khi sửa cách đọc.",
        );
      return { id: prior.id, reused: true };
    }
    const [batch] =
      await tx`INSERT INTO sales_imports(shop_id,file_hash,filename,created_by,summary) VALUES(${shop.id},${file.hash},${filename.slice(0, 255)},${user.id},${tx.json(file.summary)}) RETURNING id`;
    for (const r of file.rows) {
      const [old] =
        await tx`SELECT *,sold_on::text stored_date FROM successful_sales WHERE shop_id=${shop.id} AND order_code=${r.order} AND line_code=${r.line}`;
      if (old && (old.sku !== r.sku || old.stored_date !== r.sold))
        throw new AppError(
          409,
          "Mã dòng đã dùng cho SKU/ngày bán khác. Không ghi đè danh tính.",
        );
      await tx`INSERT INTO successful_sales(shop_id,order_code,line_code,sku,product_code,color,size,sold_on,quantity,successful,source_data,last_import_id) VALUES(${shop.id},${r.order},${r.line},${r.sku},${r.product},${r.color},${r.size},${r.sold},${r.quantity},${r.successful},${tx.json(r.raw)},${batch.id}) ON CONFLICT(shop_id,order_code,line_code) DO UPDATE SET quantity=excluded.quantity,successful=excluded.successful,product_code=COALESCE(NULLIF(excluded.product_code,''),successful_sales.product_code),color=COALESCE(NULLIF(excluded.color,''),successful_sales.color),size=COALESCE(NULLIF(excluded.size,''),successful_sales.size),source_data=excluded.source_data,last_import_id=excluded.last_import_id`;
    }
    await audit(
      tx,
      user,
      "sales_import",
      batch.id,
      null,
      file.summary,
      "Nguồn trạng thái bán thực tế; không lấy xuất kho làm bán thành công",
    );
    return { id: batch.id, reused: false, ...file.summary };
  });
}
