import { z } from "zod";
import { db, type User } from "./db";
import { AppError, managerRoles, requireRole } from "./domain";
import { requireReturnOperations } from "./return-operations-access";
export async function assignReturnCases(user: User, raw: unknown) {
  requireRole(user, managerRoles);
  await requireReturnOperations();
  const d = z
    .object({
      items: z
        .array(z.object({ id: z.uuid(), version: z.number().int() }))
        .min(1)
        .max(50),
      assignedTo: z.uuid().nullable(),
      reason: z.string().trim().min(8).max(2000),
    })
    .parse(raw);
  if (new Set(d.items.map((x) => x.id)).size !== d.items.length)
    throw new AppError(400, "Danh sách chọn bị lặp");
  return db().begin(async (tx) => {
    if (
      d.assignedTo &&
      !(await tx`SELECT id FROM users WHERE id=${d.assignedTo} AND active`)
        .length
    )
      throw new AppError(400, "Nhân viên không còn hoạt động");
    const rows =
      await tx`SELECT id,version,assigned_to FROM return_cases WHERE id IN ${tx(d.items.map((x) => x.id))} ORDER BY id FOR UPDATE`;
    if (
      rows.length !== d.items.length ||
      rows.some(
        (r) => r.version !== d.items.find((x) => x.id === r.id)!.version,
      )
    )
      throw new AppError(
        409,
        "Có hồ sơ đã thay đổi. Chưa phân công, tải lại để chọn đúng phiên bản",
      );
    await tx`UPDATE return_cases SET assigned_to=${d.assignedTo},version=version+1,updated_at=now() WHERE id IN ${tx(rows.map((r) => r.id))}`;
    await tx`INSERT INTO return_events(case_id,actor_id,action,reason,data) SELECT x.id,${user.id},'update',${d.reason},jsonb_build_object('bulk',true,'previousAssignee',x.assigned_to,'assignedTo',${d.assignedTo}::text) FROM jsonb_to_recordset(${tx.json(rows)}) AS x(id uuid,assigned_to uuid)`;
    return { updated: rows.length };
  });
}
