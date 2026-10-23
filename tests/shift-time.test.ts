import { expect, it } from "vitest";
import { shiftInterval } from "../src/lib/shift-time";

it("accepts 08:15 to noon in Vietnam and preserves the UTC offset", () => {
  expect(shiftInterval("2026-10-24T08:15", "2026-10-24T12:00")).toEqual({
    startsAt: "2026-10-24T01:15:00.000Z",
    endsAt: "2026-10-24T05:00:00.000Z",
  });
});
it("rejects midnight before the start and equal times with an actionable explanation", () => {
  expect(() => shiftInterval("2026-10-24T08:15", "2026-10-24T00:00")).toThrow(
    "12:00 là 12 giờ trưa; 00:00 là đầu ngày",
  );
  expect(() => shiftInterval("2026-10-24T08:15", "2026-10-24T08:15")).toThrow(
    "phải sau bắt đầu",
  );
});
it("accepts an overnight shift with an explicit next-day end", () => {
  expect(shiftInterval("2026-10-24T22:00", "2026-10-25T00:00")).toEqual({
    startsAt: "2026-10-24T15:00:00.000Z",
    endsAt: "2026-10-24T17:00:00.000Z",
  });
});
it("rejects incomplete dates, nonexistent dates and out-of-range clock values", () => {
  for (const end of [
    "",
    "T12:00",
    "2026-02-30T12:00",
    "2026-10-24T24:00",
    "2026-10-24T12:60",
  ])
    expect(() => shiftInterval("2026-10-24T08:15", end)).toThrow();
});
