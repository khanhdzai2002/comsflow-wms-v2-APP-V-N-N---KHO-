import bcrypt from "bcryptjs";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import ExcelJS from "exceljs";
import { db, type User } from "../src/lib/db";
import { importRows, fields } from "../src/lib/imports";
import { todayVN } from "../src/lib/domain";
import { scan } from "../src/lib/scan";
import { createHandover, confirmHandover } from "../src/lib/handover";
const sql = db();
try {
  if (
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    )
  )
    throw new Error("Demo seed chỉ được chạy trên database local");
  if (process.env.NODE_ENV === "production" || !process.argv.includes("--demo"))
    throw new Error("Demo seed chỉ chạy ngoài production với --demo");
  const [{ count }] = await sql`SELECT count(*)::int count FROM users`;
  const [demo] =
    await sql`SELECT value FROM system_settings WHERE key='demo_mode'`;
  if (count > 0 && !demo?.value)
    throw new Error("Không đưa demo vào database đã có người dùng thật");
  const password = process.env.DEMO_PASSWORD ?? "ComsFlowDemo!2026";
  const users: User[] = [];
  for (const [email, name, role] of [
    ["admin@comsflow.demo", "Quản trị Demo", "admin"],
    ["manager@comsflow.demo", "Nguyễn Minh Anh", "manager"],
    ["staff@comsflow.demo", "Trần Hoàng Nam", "staff"],
  ] as const) {
    const hash = await bcrypt.hash(password, 12);
    const [user] =
      await sql`INSERT INTO users(email,name,role,password_hash) VALUES(${email},${name},${role},${hash}) ON CONFLICT(email) DO UPDATE SET name=excluded.name RETURNING id,email,name,role`;
    users.push(user as User);
  }
  await sql`INSERT INTO system_settings(key,value) VALUES('demo_mode','true') ON CONFLICT(key) DO UPDATE SET value='true'`;
  const [warehouse] =
    await sql`SELECT * FROM warehouses WHERE name='Kho ComsMiu'`;
  const date = todayVN();
  let [shift] =
    await sql`SELECT * FROM work_shifts WHERE name=${"Ca Demo " + date}`;
  if (!shift) {
    [shift] =
      await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES(${"Ca Demo " + date},${warehouse.id},${date + "T00:00:00+07:00"}::timestamptz,${date + "T00:00:00+07:00"}::timestamptz+interval '1 day') RETURNING *`;
  }
  for (const u of users)
    await sql`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift.id},${u.id}) ON CONFLICT DO NOTHING`;
  for (const [prefix, carrier, channel] of [
    ["SPXVN", "SPX Express", "Shopee"],
    ["86", "J&T Express", "TikTok Shop"],
  ])
    await sql`INSERT INTO carrier_matching_rules(prefix,carrier_id,channel_id) SELECT ${prefix},c.id,s.id FROM shipping_carriers c,sales_channels s WHERE c.name=${carrier} AND s.name=${channel} ON CONFLICT(prefix) DO NOTHING`;
  await mkdir("public/samples", { recursive: true });
  const rows = Array.from({ length: 48 }, (_, i) => ({
    tracking_code:
      (i % 2 === 0 ? "SPXVNDEMO" : "86DEMO") + String(i + 1).padStart(6, "0"),
    order_id: "DEMO-ORDER-" + String(i + 1).padStart(4, "0"),
    channel: i % 2 === 0 ? "Shopee" : "TikTok Shop",
    shop: i % 2 === 0 ? "ComsMiu Shopee Demo" : "ComsMiu TikTok Demo",
    carrier: ["SPX Express", "J&T Express", "GHN", "Viettel Post"][i % 4],
    due_date: date,
    status: i === 45 ? "cancelled" : i === 46 ? "blocked" : "awaiting_scan",
    sku: "CM-" + ["AO", "QUAN", "VAY"][i % 3],
    product_name: ["Áo thun ComsMiu", "Quần suông ComsMiu", "Váy midi ComsMiu"][
      i % 3
    ],
    color: ["Đen", "Trắng", "Be"][i % 3],
    size: ["S", "M", "L"][i % 3],
    quantity: "1",
    warehouse: "Kho ComsMiu",
  }));
  for (const [channel, name] of [
    ["Shopee", "shopee-demo"],
    ["TikTok Shop", "tiktok-demo"],
  ]) {
    const subset = rows.filter((r) => r.channel === channel);
    if (!existsSync(`public/samples/${name}.csv`))
      await writeFile(
        `public/samples/${name}.csv`,
        "\uFEFF" +
          [
            fields.join(","),
            ...subset.map((r) =>
              fields
                .map((f) => '"' + r[f].replaceAll('"', '""') + '"')
                .join(","),
            ),
          ].join("\r\n"),
      );
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Đơn demo");
    sheet.columns = fields.map((f) => ({ header: f, key: f, width: 22 }));
    sheet.addRows(subset);
    if (!existsSync(`public/samples/${name}.xlsx`))
      await book.xlsx.writeFile(`public/samples/${name}.xlsx`);
  }
  const [loaded] =
    await sql`SELECT value FROM system_settings WHERE key='demo_loaded'`;
  if (!loaded) {
    const result = await importRows(
      users[0],
      "DEMO — dữ liệu mô phỏng",
      rows,
      {},
    );
    if (result.errors.length) throw new Error(JSON.stringify(result.errors));
    for (let i = 0; i < 30; i++)
      await scan(users[i % 3], {
        code: rows[i].tracking_code,
        requestId: crypto.randomUUID(),
        shiftId: shift.id,
        warehouseId: warehouse.id,
        method: i % 2 ? "hid" : "manual",
      });
    await scan(users[2], {
      code: rows[0].tracking_code,
      requestId: crypto.randomUUID(),
      shiftId: shift.id,
      warehouseId: warehouse.id,
      method: "hid",
    });
    await scan(users[2], {
      code: "SPXVNUNKNOWNDEMO",
      requestId: crypto.randomUUID(),
      shiftId: shift.id,
      warehouseId: warehouse.id,
      method: "manual",
    });
    for (const carrier of await sql`SELECT * FROM shipping_carriers`) {
      const shipments =
        await sql`SELECT id FROM shipments WHERE carrier_id=${carrier.id} AND status='scanned' ORDER BY tracking_code LIMIT 3`;
      if (shipments.length) {
        const batch = await createHandover(users[1], {
          carrierId: carrier.id,
          warehouseId: warehouse.id,
          shipmentIds: shipments.map((s) => s.id),
          note: "Phiếu DEMO — bàn giao nội bộ mô phỏng",
        });
        await confirmHandover(users[1], batch.id);
      }
    }
    await sql`INSERT INTO system_settings(key,value) VALUES('demo_loaded','true')`;
  }
  console.log(
    "Demo sẵn sàng. Tài khoản và hướng dẫn trong README. Không dùng database này cho sản xuất.",
  );
} finally {
  await sql.end();
}
