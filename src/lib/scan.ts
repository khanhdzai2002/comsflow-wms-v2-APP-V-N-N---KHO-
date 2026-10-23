import { detectCarrier } from "./carriers";
import { db, type User } from "./db";
import {
  scanSchema,
  normalizeCode,
  validCode,
  AppError,
  outcomes,
} from "./domain";
export async function scan(user: User, input: unknown) {
  const data = scanSchema.parse(input);
  const code = normalizeCode(data.code);
  const sql = db();
  return sql.begin(async (tx) => {
    // Idempotency protects retries after a lost HTTP response, including unknown codes.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${data.requestId},0))`;
    const [prior] =
      await tx`SELECT * FROM scan_events WHERE request_id=${data.requestId}`;
    if (prior) {
      if (prior.user_id !== user.id)
        throw new AppError(409, "Mã yêu cầu đã được sử dụng");
      const keys = Object.keys(data) as (keyof typeof data)[];
      if (
        prior.request_payload &&
        keys.some((key) => prior.request_payload[key] !== data[key])
      )
        throw new AppError(409, "Mã yêu cầu đã gắn với dữ liệu khác");
      return prior.response;
    }
    if (
      (
        await tx`SELECT request_id FROM retired_requests WHERE kind='scans' AND request_id=${data.requestId}`
      ).length
    )
      throw new AppError(
        410,
        "Lượt quét cũ đã được dọn. Không ghi nhận lại bằng mã yêu cầu cũ.",
      );
    const [shift] =
      await tx`SELECT s.* FROM work_shifts s JOIN shift_members m ON m.shift_id=s.id
      WHERE s.id=${data.shiftId} AND s.warehouse_id=${data.warehouseId} AND m.user_id=${user.id} AND s.starts_at<=now() AND s.ends_at>now()`;
    if (!shift)
      throw new AppError(
        400,
        "Chọn ca đang hoạt động, đúng kho và đã được phân công cho bạn",
      );
    const [shipment] = validCode(code)
      ? await tx`SELECT * FROM shipments WHERE tracking_code=${code} FOR UPDATE`
      : [];
    let outcome = "success";
    if (!validCode(code)) outcome = "invalid";
    else if (!shipment) outcome = "unknown";
    else if (shipment.scanned_at) outcome = "duplicate";
    else if (shipment.status === "cancelled") outcome = "cancelled";
    else if (!["pending", "awaiting_scan"].includes(shipment.status))
      outcome = "blocked";
    else if (shipment.warehouse_id !== data.warehouseId)
      outcome = "warehouse_mismatch";
    else if (data.carrierId && shipment.carrier_id !== data.carrierId)
      outcome = "carrier_mismatch";
    const [clock] = await tx`SELECT clock_timestamp() AS at`;
    if (outcome === "success")
      await tx`UPDATE shipments SET scanned_at=${clock.at},scanned_by=${user.id},shift_id=${data.shiftId},status='scanned',updated_at=now() WHERE id=${shipment.id}`;
    const [detail] = shipment
      ? await tx`SELECT s.*,o.external_id,c.name channel,sh.name shop,ca.name carrier,w.name warehouse,u.name first_scanned_by
      FROM shipments s JOIN orders o ON o.id=s.order_id JOIN sales_channels c ON c.id=o.channel_id
      JOIN shops sh ON sh.id=o.shop_id JOIN shipping_carriers ca ON ca.id=s.carrier_id JOIN warehouses w ON w.id=s.warehouse_id LEFT JOIN users u ON u.id=s.scanned_by WHERE s.id=${shipment.id}`
      : [];
    const items = shipment
      ? await tx`SELECT sku,name,color,size,quantity FROM order_items WHERE order_id=${shipment.order_id}`
      : [];
    const identification = await detectCarrier(
      tx,
      code,
      "",
      shipment?.carrier_id ?? null,
    );
    const id = crypto.randomUUID();
    const response = {
      id,
      outcome,
      message: outcomes[outcome],
      code,
      at: clock.at,
      employee: user.name,
      shipment: detail ?? null,
      items,
      hint: outcome === "unknown" ? identification.hint : null,
      carrierIdentification: identification,
    };
    await tx`INSERT INTO scan_events(id,request_id,shipment_id,raw_code,outcome,user_id,shift_id,warehouse_id,method,created_at,response,request_payload)
      VALUES(${id},${data.requestId},${shipment?.id ?? null},${data.code},${outcome},${user.id},${data.shiftId},${data.warehouseId},${data.method},${clock.at},${tx.json(response)},${tx.json(data)})`;
    if (!["success", "duplicate", "invalid"].includes(outcome))
      await tx`INSERT INTO exception_cases(scan_event_id,shipment_id,kind) VALUES(${id},${shipment?.id ?? null},${outcome})`;
    return response;
  });
}
