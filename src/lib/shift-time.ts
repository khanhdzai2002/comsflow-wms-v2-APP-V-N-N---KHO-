import { formatTime } from "./domain";

function vietnamDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error("Chọn đầy đủ ngày, giờ và phút của ca làm việc.");
  const date = new Date(value + ":00+07:00");
  if (
    !Number.isFinite(date.getTime()) ||
    new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16) !==
      value
  )
    throw new Error("Ngày hoặc giờ của ca làm việc không hợp lệ.");
  return date;
}

export function shiftInterval(starts: string, ends: string) {
  const start = vietnamDateTime(starts);
  const end = vietnamDateTime(ends);
  if (end <= start)
    throw new Error(
      `Kết thúc (${formatTime(end)}) phải sau bắt đầu (${formatTime(start)}). 12:00 là 12 giờ trưa; 00:00 là đầu ngày. Ca qua đêm cần chọn ngày kết thúc hôm sau.`,
    );
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}
