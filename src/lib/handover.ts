import { z } from "zod";
import { db, audit, type User } from "./db";
import { AppError, requireRole, managerRoles } from "./domain";
const schema = z.object({
  carrierId: z.uuid(),
  warehouseId: z.uuid(),
  shipmentIds: z.array(z.uuid()).min(1).max(2000),
  note: z.string().max(1000).default(""),
});
export async function createHandover(user: User, input: unknown) {
  requireRole(user, managerRoles);
  const d = schema.parse(input);
  const ids = [...new Set(d.shipmentIds)].sort();
  return db().begin(async (tx) => {
    const rows =
      await tx`SELECT * FROM shipments WHERE id IN ${tx(ids)} ORDER BY id FOR UPDATE`;
    if (
      rows.length !== ids.length ||
      rows.some(
        (s) =>
          !s.scanned_at ||
          s.handed_at ||
          !["scanned", "awaiting_handover"].includes(s.status) ||
          s.carrier_id !== d.carrierId ||
          s.warehouse_id !== d.warehouseId,
      )
    )
      throw new AppError(
        409,
        "Chỉ chọn vận đơn đã quét, chưa bàn giao, cùng hãng và kho, không bị chặn",
      );
    const existing =
      await tx`SELECT * FROM handover_items WHERE shipment_id IN ${tx(ids)} AND released_at IS NULL`;
    if (existing.length)
      throw new AppError(409, "Vận đơn đã nằm trong một phiếu bàn giao");
    const [batch] =
      await tx`INSERT INTO handover_batches(carrier_id,warehouse_id,created_by,note) VALUES(${d.carrierId},${d.warehouseId},${user.id},${d.note}) RETURNING *`;
    for (const id of ids)
      await tx`INSERT INTO handover_items(batch_id,shipment_id) VALUES(${batch.id},${id})`;
    await tx`UPDATE shipments SET status='awaiting_handover',updated_at=now() WHERE id IN ${tx(ids)}`;
    await audit(
      tx,
      user,
      "handover_draft",
      batch.id,
      null,
      { ...batch, shipments: ids },
      d.note || "Tạo phiếu bàn giao nội bộ",
    );
    return batch;
  });
}
export async function confirmHandover(user: User, id: string) {
  requireRole(user, managerRoles);
  z.uuid().parse(id);
  return db().begin(async (tx) => {
    const [batch] =
      await tx`SELECT * FROM handover_batches WHERE id=${id} FOR UPDATE`;
    if (!batch) throw new AppError(404, "Không tìm thấy phiếu");
    if (batch.status === "confirmed") return batch;
    if (batch.status === "cancelled")
      throw new AppError(409, "Phiếu đã hủy, không thể xác nhận bàn giao");
    const rows =
      await tx`SELECT s.* FROM shipments s JOIN handover_items h ON h.shipment_id=s.id WHERE h.batch_id=${id} AND h.released_at IS NULL ORDER BY s.id FOR UPDATE OF s`;
    if (
      !rows.length ||
      rows.some(
        (s) =>
          s.status !== "awaiting_handover" ||
          !s.scanned_at ||
          s.handed_at ||
          s.carrier_id !== batch.carrier_id ||
          s.warehouse_id !== batch.warehouse_id,
      )
    )
      throw new AppError(
        409,
        "Phiếu có đơn không đủ điều kiện. Cần đối soát trước.",
      );
    await tx`UPDATE shipments SET status='handed_over',handed_at=clock_timestamp(),handed_by=${user.id},updated_at=now() WHERE id IN ${tx(rows.map((s) => s.id))}`;
    const [after] =
      await tx`UPDATE handover_batches SET status='confirmed',confirmed_at=clock_timestamp(),confirmed_by=${user.id} WHERE id=${id} RETURNING *`;
    await audit(
      tx,
      user,
      "handover_confirm",
      id,
      batch,
      after,
      "Xác nhận bàn giao nội bộ; không phải xác nhận chính thức của hãng",
    );
    return after;
  });
}
export async function cancelHandover(user: User, input: unknown) {
  requireRole(user, managerRoles);
  const d = z
    .object({ id: z.uuid(), reason: z.string().trim().min(8).max(1000) })
    .parse(input);
  return db().begin(async (tx) => {
    const [before] =
      await tx`SELECT * FROM handover_batches WHERE id=${d.id} FOR UPDATE`;
    if (!before) throw new AppError(404, "Không tìm thấy phiếu");
    if (before.status === "cancelled") return before;
    if (before.status !== "draft")
      throw new AppError(
        409,
        "Chỉ được hủy phiếu nháp; không hủy phiếu đã bàn giao",
      );
    const shipments =
      await tx`SELECT s.* FROM shipments s JOIN handover_items h ON h.shipment_id=s.id WHERE h.batch_id=${d.id} AND h.released_at IS NULL ORDER BY s.id FOR UPDATE OF s`;
    if (shipments.some((s) => s.status !== "awaiting_handover" || s.handed_at))
      throw new AppError(
        409,
        "Phiếu có trạng thái không nhất quán, cần đối soát",
      );
    if (shipments.length)
      await tx`UPDATE shipments SET status='scanned',updated_at=now() WHERE id IN ${tx(shipments.map((s) => s.id))}`;
    await tx`UPDATE handover_items SET released_at=clock_timestamp() WHERE batch_id=${d.id} AND released_at IS NULL`;
    const [after] =
      await tx`UPDATE handover_batches SET status='cancelled',note=concat_ws(E'\n',nullif(note,''),${"Hủy: " + d.reason}::text) WHERE id=${d.id} RETURNING *`;
    await audit(
      tx,
      user,
      "handover_cancel",
      d.id,
      before,
      { ...after, shipmentIds: shipments.map((s) => s.id) },
      d.reason,
    );
    return after;
  });
}
