// Full tracking formats, not arbitrary prefix guesses. These supplement the
// administrator's matching rules for both outbound hints and return imports.
export const carrierFormats = [
  {
    name: "J&T Express",
    keys: ["jtexpress", "jt", "jnt"],
    pattern: /^8[56]\d{10}$/,
    description: "85/86 · 12 chữ số",
  },
  {
    name: "SPX Express",
    keys: ["spxexpress", "spx", "shopeeexpress"],
    pattern: /^SPXVN\d{11}[A-Z]$/,
    description: "SPXVN · 11 số và 1 chữ",
  },
  {
    name: "BEST Express",
    keys: ["bestexpress", "best"],
    pattern: /^TTVN\d{8,16}$/,
    description: "TTVN · 8–16 chữ số",
  },
  {
    name: "GHN",
    keys: ["ghn", "giaohangnhanh"],
    pattern: /^(?:VNGH\d{11}|G[A-Z0-9]{7})$/,
    description: "VNGH · 11 số, hoặc G · 7 chữ/số",
  },
  {
    name: "Viettel Post",
    keys: ["viettelpost", "vtp"],
    pattern: /^VTPVN\d{10}$/,
    description: "VTPVN · 10 chữ số",
  },
] as const;
