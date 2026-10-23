import { z } from "zod";
import { db, audit, type User } from "./db";
import { AppError, managerRoles, requireRole } from "./domain";

export async function startOwnShift(user: User, warehouseId: string) {
  requireRole(user, managerRoles);
  z.uuid().parse(warehouseId);
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"shift:" + user.id + ":" + warehouseId},0))`;
    const [warehouse] =
      await tx`SELECT id FROM warehouses WHERE id=${warehouseId}`;
    if (!warehouse) throw new AppError(404, "Không tìm thấy kho");
    // Read wall-clock time after the lock: a waiting transaction may have started
    // before another request created the active shift.
    const [clock] = await tx`SELECT clock_timestamp() AS at`;
    const [existing] =
      await tx`SELECT s.* FROM work_shifts s JOIN shift_members m ON m.shift_id=s.id WHERE m.user_id=${user.id} AND s.warehouse_id=${warehouseId} AND s.starts_at<=${clock.at} AND s.ends_at>${clock.at} ORDER BY s.starts_at DESC LIMIT 1`;
    if (existing) return existing;
    const [shift] =
      await tx`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at)
      VALUES(${"Ca nhanh · " + user.name},${warehouseId},${clock.at},((${clock.at}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') RETURNING *`;
    await tx`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift.id},${user.id})`;
    await audit(
      tx,
      user,
      "shift_start_self",
      shift.id,
      null,
      { ...shift, members: [user.id] },
      "Quản lý mở ca cho bản thân đến hết ngày Việt Nam",
    );
    return shift;
  });
}

export async function assignShift(user: User, input: unknown) {
  requireRole(user, managerRoles);
  const d = z
    .object({ shiftId: z.uuid(), members: z.array(z.uuid()).min(1).max(500) })
    .parse(input);
  return db().begin(async (tx) => {
    const [shift] =
      await tx`SELECT * FROM work_shifts WHERE id=${d.shiftId} FOR UPDATE`;
    if (!shift) throw new AppError(404, "Không tìm thấy ca");
    if (new Date(shift.ends_at).getTime() <= Date.now())
      throw new AppError(409, "Ca đã kết thúc. Hãy tạo ca mới.");
    const members = [...new Set(d.members)];
    const active =
      await tx`SELECT id FROM users WHERE id IN ${tx(members)} AND active`;
    if (active.length !== members.length)
      throw new AppError(400, "Chỉ phân công tài khoản đang hoạt động");
    const before =
      await tx`SELECT user_id FROM shift_members WHERE shift_id=${d.shiftId}`;
    await tx`DELETE FROM shift_members WHERE shift_id=${d.shiftId}`;
    for (const member of members)
      await tx`INSERT INTO shift_members(shift_id,user_id) VALUES(${d.shiftId},${member})`;
    await audit(
      tx,
      user,
      "shift_assign",
      d.shiftId,
      before.map((m) => m.user_id),
      members,
      "Cập nhật phân công; giữ nguyên nhật ký quét trước đó",
    );
    return { ok: true };
  });
}
