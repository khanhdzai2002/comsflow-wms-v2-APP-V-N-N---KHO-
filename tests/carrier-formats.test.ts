import { expect, it } from "vitest";
import { identifyCarrier, type CarrierCatalog } from "../src/lib/carriers";
import { groupReturnCarriers } from "../src/lib/return-carriers";

const catalog = (extra: Record<string, unknown> = {}) =>
  ({
    carriers: [
      { id: "jt", name: "J&T Express" },
      { id: "spx", name: "SPX Express" },
      { id: "best", name: "BEST Express" },
      { id: "ghn", name: "GHN" },
      { id: "vtp", name: "Viettel Post" },
    ],
    rules: [],
    disabledRules: [],
    aliases: [
      { alias: "jnt", carrier_id: "jt" },
      { alias: "spx", carrier_id: "spx" },
    ],
    ...extra,
  }) as unknown as CarrierCatalog;

it.each([
  ["854160000001", "jt"],
  ["862000000001", "jt"],
  ["SPXVN00000000001A", "spx"],
  ["TTVN1234567890", "best"],
  ["VNGH12345678901", "ghn"],
  ["GABC1234", "ghn"],
  ["VTPVN1234567890", "vtp"],
])(
  "recognizes the complete tracking format %s without a saved prefix rule",
  (code, id) => {
    expect(identifyCarrier(catalog(), code)).toMatchObject({
      carrierId: id,
      origin: "format",
      conflict: false,
    });
  },
);
it.each([
  "8554",
  "85123456789",
  "8512345678901",
  "SPXVN123",
  "VTPVN123",
  "VNGH123",
  "123456789012",
  "GABC12345",
  "TTVNABC",
  "MY-GABC1234",
  "NV1234567890",
  "",
])("keeps incomplete/unsupported tracking %s unresolved", (code) => {
  expect(identifyCarrier(catalog(), code)).toMatchObject({
    carrierId: null,
    origin: "unknown",
  });
});
it("preserves manual identity, recognized file names and configured prefixes ahead of defaults", () => {
  const configured = catalog({
    rules: [{ prefix: "85", carrier_id: "ghn", carrier: "GHN", active: true }],
  });
  expect(identifyCarrier(configured, "854160000001")).toMatchObject({
    carrierId: "ghn",
    origin: "prefix",
  });
  expect(
    identifyCarrier(configured, "854160000001", "J&T Express"),
  ).toMatchObject({ carrierId: "jt", origin: "file", conflict: true });
  expect(
    identifyCarrier(catalog(), "854160000001", "SPX", "ghn"),
  ).toMatchObject({ carrierId: "ghn", origin: "verified", conflict: true });
  expect(identifyCarrier(catalog(), "854160000001", "SPX")).toMatchObject({
    carrierId: "spx",
    origin: "file",
    conflict: true,
  });
});
it("does not bypass a disabled administrative rule or invent a missing catalog carrier", () => {
  expect(
    identifyCarrier(
      catalog({ disabledRules: [{ prefix: "85", active: false }] }),
      "854160000001",
    ),
  ).toMatchObject({ carrierId: null, origin: "unknown" });
  expect(
    identifyCarrier(catalog({ carriers: [] }), "854160000001"),
  ).toMatchObject({ carrierId: null, missingCatalog: "J&T Express" });
  expect(
    identifyCarrier(
      catalog({
        carriers: [{ id: "custom", name: "My JT" }],
        aliases: [{ alias: "jnt", carrier_id: "custom" }],
      }),
      "854160000001",
    ).carrierId,
  ).toBe("custom");
});
it("partitions no tracking, unknown tracking and mixed carriers with one group per request", () => {
  const groups = groupReturnCarriers([
    { caseId: "no-code", hasTracking: false, carrierId: null, carrier: "" },
    { caseId: "bad-code", hasTracking: true, carrierId: null, carrier: "" },
    {
      caseId: "jt",
      hasTracking: true,
      carrierId: "jt",
      carrier: "J&T Express",
    },
    { caseId: "jt", hasTracking: false, carrierId: null, carrier: "" },
    {
      caseId: "mixed",
      hasTracking: true,
      carrierId: "jt",
      carrier: "J&T Express",
    },
    { caseId: "mixed", hasTracking: true, carrierId: null, carrier: "" },
  ]);
  expect(groups).toEqual([
    {
      case_id: "no-code",
      carrier_id: "no_tracking",
      carrier: "Chưa có mã vận đơn hoàn",
    },
    {
      case_id: "bad-code",
      carrier_id: "unknown",
      carrier: "Chưa nhận diện hãng",
    },
    { case_id: "jt", carrier_id: "jt", carrier: "J&T Express" },
    {
      case_id: "mixed",
      carrier_id: "mixed",
      carrier: "Nhiều hãng / cần đối chiếu",
    },
  ]);
});
