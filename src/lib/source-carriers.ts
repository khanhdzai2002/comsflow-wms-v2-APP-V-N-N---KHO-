// Verified label families; detect the sales channel from the template, not just a carrier.
export const sourceCarriers = [
  "J&T Express",
  "BEST Express",
  "SPX Express",
  "GHN",
] as const;
export type SourceCarrier = (typeof sourceCarriers)[number];
export function canonicalSourceCarrier(name: string): SourceCarrier | null {
  if (/^J\s*&\s*T(?:\s+Express)?$/i.test(name.trim())) return "J&T Express";
  if (/^BEST(?:\s+Express)?$/i.test(name.trim())) return "BEST Express";
  if (/^SPX(?:\s+Express)?$/i.test(name.trim())) return "SPX Express";
  const plain = name.trim().normalize("NFD").replace(/\p{M}/gu, "");
  if (
    /^(?:GHN|Giao\s+Hang\s+Nhanh|GHN\s*[-–·]\s*Giao\s+Hang\s+Nhanh)$/i.test(
      plain,
    )
  )
    return "GHN";
  return null;
}

export type SourceChannel = "TikTok Shop" | "Shopee";
