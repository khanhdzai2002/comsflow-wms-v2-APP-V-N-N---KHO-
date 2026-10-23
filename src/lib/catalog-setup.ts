import { db, audit, type User, type Tx } from "./db";
import { requireRole } from "./domain";
import { carrierCatalog, carrierKey } from "./carriers";
import defaults from "./catalog-defaults.json" with { type: "json" };

export async function populateCatalogs(tx: Tx) {
  const created: { kind: string; name: string; id: string }[] = [];
  if (!(await tx`SELECT id FROM warehouses LIMIT 1`).length) {
    const [row] =
      await tx`INSERT INTO warehouses(name) VALUES(${defaults.warehouse}) RETURNING id,name`;
    created.push({ kind: "warehouse", id: row.id, name: row.name });
  }
  for (const name of defaults.channels) {
    const [row] =
      await tx`INSERT INTO sales_channels(name) VALUES(${name}) ON CONFLICT(name) DO NOTHING RETURNING id,name`;
    if (row) created.push({ kind: "channel", id: row.id, name: row.name });
  }
  for (const item of defaults.carriers) {
    const catalog = await carrierCatalog(tx);
    let carrier = catalog.carriers.find(
      (c) =>
        item.aliases.includes(carrierKey(c.name)) ||
        catalog.aliases.some(
          (a) => item.aliases.includes(a.alias) && a.carrier_id === c.id,
        ),
    );
    if (!carrier) {
      const [row] =
        await tx`INSERT INTO shipping_carriers(name) VALUES(${item.name}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id,name`;
      if (!row) throw new Error("Không tạo được danh mục hãng vận chuyển");
      carrier = row;
      created.push({ kind: "carrier", id: carrier.id, name: carrier.name });
    }
    if (!carrier) throw new Error("Chưa xác định được hãng vận chuyển");
    for (const alias of item.aliases) {
      const [row] =
        await tx`INSERT INTO carrier_aliases(alias,carrier_id) VALUES(${alias},${carrier.id}) ON CONFLICT(alias) DO NOTHING RETURNING alias`;
      if (row)
        created.push({
          kind: "carrier_alias",
          id: row.alias,
          name: item.name + " · " + alias,
        });
    }
  }
  const [setting] =
    await tx`INSERT INTO system_settings(key,value) VALUES('cutoff_hour','17') ON CONFLICT(key) DO NOTHING RETURNING key`;
  if (setting)
    created.push({
      kind: "setting",
      id: setting.key,
      name: "Mốc xuất kho 17 giờ",
    });
  return created;
}
export async function setupCatalogs(user: User) {
  requireRole(user, ["admin"]);
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742920)`;
    const created = await populateCatalogs(tx);
    if (created.length)
      await audit(
        tx,
        user,
        "catalog_setup",
        "operating-catalogs",
        null,
        created,
        "Thiết lập danh mục cơ bản; giữ nguyên cấu hình và dữ liệu hiện có",
      );
    return { ok: true, created };
  });
}
