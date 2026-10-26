import type { SourceCarrier, SourceChannel } from "./source-carriers";

export type SourceLabel = {
  trackingCode: string;
  orderId: string;
  carrier: SourceCarrier;
  channel: SourceChannel;
  pages: number[];
};
export type SourceCarrierGroup = {
  carrier: SourceCarrier;
  channel: SourceChannel;
  shipments: number;
  orders: number;
  pages: number[];
};

export function formatSourcePages(pages: number[], maxRanges = 12) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (sorted[i + 1] === sorted[i] + 1) i++;
    ranges.push(start === sorted[i] ? String(start) : `${start}–${sorted[i]}`);
  }
  return (
    ranges.slice(0, maxRanges).join(", ") +
    (ranges.length > maxRanges ? ", …" : "")
  );
}

export type SourcePdf = {
  hash: string;
  pageCount: number;
  labels: SourceLabel[];
  duplicatePages: number;
  continuationPages: number;
  detectedCarriers: SourceCarrier[];
  detectedChannels: SourceChannel[];
  carrierGroups: SourceCarrierGroup[];
  orderCount: number;
  errors: { page: number; message: string }[];
};

// Support verified Shopee SPX/GHN and TikTok J&T/BEST label families.
// Never guess tracking IDs from phone numbers, order IDs, or page count.
export type SourceAnalyzerState = {
  labels: SourceLabel[];
  errors: SourcePdf["errors"];
  pageCount: number;
  duplicatePages: number;
  continuationPages: number;
  block?: {
    label: SourceLabel;
    hasProducts: boolean;
    orderConfirmed?: boolean;
  };
};
export function sourceLabelAnalyzer(hash: string, state?: SourceAnalyzerState) {
  const labels = new Map<string, SourceLabel>(
    (state?.labels ?? []).map((l) => [l.trackingCode, l]),
  );
  const errors: SourcePdf["errors"] = state?.errors ?? [];
  let pageCount = state?.pageCount ?? 0;
  let duplicatePages = state?.duplicatePages ?? 0;
  let continuationPages = state?.continuationPages ?? 0;
  // A physical label and its adjacent product pages form one parcel. An Order ID
  // alone cannot join arbitrary pages elsewhere in the file (one order may have
  // several parcels). Validate each contiguous block before counting anything.
  let block:
    | { label: SourceLabel; hasProducts: boolean; orderConfirmed?: boolean }
    | undefined = state?.block;
  const finishBlock = () => {
    if (!block) return;
    const { label, hasProducts } = block;
    if (block.orderConfirmed === false) {
      errors.push({
        page: label.pages[0],
        message:
          "Tem Shopee có Mã đơn hàng nhưng chưa có OrderSN khớp trên tem hoặc trang sản phẩm liền sau.",
      });
    } else if (!hasProducts) {
      errors.push({
        page: label.pages[0],
        message:
          "Tem có mã vận đơn và Order ID nhưng thiếu bảng sản phẩm trên tem hoặc các trang tiếp liền cùng Order ID.",
      });
    } else {
      const previous = labels.get(label.trackingCode);
      if (
        previous &&
        (previous.orderId !== label.orderId ||
          previous.carrier !== label.carrier ||
          previous.channel !== label.channel)
      ) {
        errors.push({
          page: label.pages[0],
          message: `Mã ${label.trackingCode} xuất hiện với nhiều Order ID hoặc hãng khác nhau.`,
        });
      } else {
        if (previous) {
          previous.pages.push(...label.pages);
          duplicatePages++;
        } else labels.set(label.trackingCode, label);
        continuationPages += label.pages.length - 1;
      }
    }
    block = undefined;
  };
  const addPage = (text: string) => {
    const page = ++pageCount;
    const normalized = text.normalize("NFKC").replace(/\u00a0/g, " ");
    // The Shopee PDF templates have one labelled tracking code and two independent
    // labelled order references. Never apply TikTok's repeated-barcode rule here.
    const spxMatches =
      normalized.match(/(?<![A-Z0-9])SPXVN\d{11}[A-Z](?![A-Z0-9])/gi) ?? [];
    const shopeeText = normalized
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
    const compact = shopeeText.replace(/\s+/g, "");
    const labelledCodes = [
      ...shopeeText.matchAll(/Ma\s*van\s*don\s*:\s*(\S+)/gi),
    ].map((m) => m[1].toUpperCase());
    const shopeeOrderIds = [
      ...new Set(
        [
          ...shopeeText.matchAll(
            /Ma\s*don\s*hang\s*:\s*([A-Z0-9]{14})(?![A-Z0-9])/gi,
          ),
        ].map((m) => m[1].toUpperCase()),
      ),
    ];
    const orderSNs = [
      ...new Set(
        [
          ...normalized.matchAll(/OrderSN\s*:\s*([A-Z0-9]{14})(?![A-Z0-9])/gi),
        ].map((m) => m[1].toUpperCase()),
      ),
    ];
    const shopeeProducts =
      /Noidunghang\(TongSLsanpham:/i.test(compact) ||
      (/THONGTINDONHANG/i.test(compact) && /Tensanpham/i.test(compact));
    const shopeeTemplate =
      spxMatches.length > 0 ||
      shopeeOrderIds.length > 0 ||
      orderSNs.length > 0 ||
      labelledCodes.some((code) => /^G[A-Z0-9]{7}$/.test(code));
    if (shopeeTemplate) {
      const spxCodes = [...new Set(spxMatches.map((c) => c.toUpperCase()))];
      const trackingCode = labelledCodes[0];
      // GHN's verified Shopee format is exactly G + 7 letters/digits. Only read
      // it from Mã vận đơn: product/SKU text can also contain eight-letter G words.
      // Carrier alone never establishes Shopee; validate both order references
      // and the product block below, without using the filename or a broad G hint.
      const carrier: SourceCarrier | null = /^SPXVN\d{11}[A-Z]$/.test(
        trackingCode ?? "",
      )
        ? "SPX Express"
        : /^G[A-Z0-9]{7}$/.test(trackingCode ?? "")
          ? "GHN"
          : null;
      if (
        !spxCodes.length &&
        !/Mavandon:/i.test(compact) &&
        block?.label.channel === "Shopee" &&
        orderSNs.length === 1 &&
        (!shopeeOrderIds.length ||
          (shopeeOrderIds.length === 1 && shopeeOrderIds[0] === orderSNs[0])) &&
        block.label.orderId === orderSNs[0] &&
        shopeeProducts
      ) {
        block.label.pages.push(page);
        block.hasProducts = true;
        block.orderConfirmed = true;
        return;
      }
      finishBlock();
      if (
        !carrier ||
        labelledCodes.length !== 1 ||
        (carrier === "SPX Express"
          ? spxCodes.length !== 1 || trackingCode !== spxCodes[0]
          : spxCodes.length !== 0) ||
        shopeeOrderIds.length !== 1 ||
        orderSNs.length > 1 ||
        (orderSNs.length === 1 && shopeeOrderIds[0] !== orderSNs[0]) ||
        /(?<![A-Z0-9])(?:86\d{10}|TTVN\d{8,16})(?![A-Z0-9])/i.test(normalized)
      ) {
        errors.push({
          page,
          message:
            "Chưa nhận dạng chắc chắn tem Shopee/SPX hoặc GHN: cần một Mã vận đơn SPXVN hoặc GHN (G + 7 chữ/số), Mã đơn hàng và OrderSN trùng nhau. Trang sản phẩm tiếp theo phải có OrderSN khớp tem liền trước. Kiểm tra file gốc; không lấy số trang làm số đơn.",
        });
        return;
      }
      block = {
        label: {
          trackingCode,
          orderId: shopeeOrderIds[0],
          carrier,
          channel: "Shopee",
          pages: [page],
        },
        hasProducts: shopeeProducts,
        orderConfirmed: orderSNs.length === 1,
      };
      return;
    }
    const jtMatches =
      normalized.match(/(?<![A-Z0-9])86\d{10}(?![A-Z0-9])/gi) ?? [];
    const bestMatches =
      normalized.match(/(?<![A-Z0-9])TTVN\d{8,16}(?![A-Z0-9])/gi) ?? [];
    const matches = [...jtMatches, ...bestMatches].map((code) =>
      code.toUpperCase(),
    );
    const candidates = [...new Set(matches)];
    const bestMarker = /TT[\s-]*VN[\s-]*BEST|\bBEST[\s-]+EXPRESS\b/i.test(
      normalized,
    );
    const carrier: SourceCarrier = bestMatches.length
      ? "BEST Express"
      : "J&T Express";
    const orderIds = [
      ...new Set(
        [...normalized.matchAll(/Order\s*ID\s*:\s*(\d{15,25})(?!\d)/gi)].map(
          (m) => m[1],
        ),
      ),
    ];
    const hasProducts = /Product\s+Name/i.test(normalized);
    // Some genuine TikTok/BEST labels render the carrier logo as an image and
    // omit the TT-VN-BEST service text. A prefix alone is insufficient: require
    // the complete shipping form plus repeated barcode/order references instead.
    const shippingTemplate =
      /Nguoi\s*gui\s*:?/i.test(shopeeText) &&
      /Nguoi\s*nhan\s*:?/i.test(shopeeText) &&
      /Trong\s*luong\s*:/i.test(shopeeText) &&
      /Thoi\s*gian\s*dat\s*hang\s*:/i.test(shopeeText) &&
      /Ngay\s*giao\s*du\s*kien\s*:/i.test(shopeeText) &&
      [...normalized.matchAll(/Order\s*ID\s*:\s*\d{15,25}(?!\d)/gi)].length >=
        2;
    const bestTemplate = bestMarker || shippingTemplate;
    const productContinuation =
      hasProducts || /Qty\s+Total\s*:/i.test(normalized);
    // A continuation has no shipping-label block. Do not swallow an unsupported
    // carrier's full label merely because its Order ID matches the previous one.
    const shippingBlock =
      bestMarker ||
      /J\s*&\s*T|Người\s+(?:gửi|nhận)|\bCOD\b|\b(?:SPXVN|TTVN)[A-Z0-9]+/i.test(
        normalized,
      );
    if (
      candidates.length === 0 &&
      !shippingBlock &&
      productContinuation &&
      orderIds.length === 1
    ) {
      if (
        block?.label.channel === "TikTok Shop" &&
        block.label.orderId === orderIds[0]
      ) {
        block.label.pages.push(page);
        block.hasProducts ||= hasProducts;
        return;
      }
      finishBlock();
      errors.push({
        page,
        message:
          "Trang sản phẩm tiếp theo không khớp Order ID của tem ngay trước đó hoặc thiếu tem đứng trước. Không tự ghép để tránh đếm nhầm kiện.",
      });
      return;
    }
    finishBlock();
    if (
      (carrier === "BEST Express" && !bestTemplate) ||
      (carrier === "J&T Express" && bestMarker) ||
      candidates.length !== 1 ||
      matches.length < 2 ||
      orderIds.length !== 1
    ) {
      errors.push({
        page,
        message:
          "Chưa nhận dạng chắc chắn tem: cần một mã J&T (86 + 10 số) hoặc BEST (TTVN và dấu hãng BEST hoặc đầy đủ biểu mẫu giao hàng TikTok) in lặp, cùng một Order ID. Trang sản phẩm tiếp theo cần Order ID khớp tem liền trước; trang ảnh/mẫu khác cần file gốc hoặc CSV/XLSX.",
      });
      return;
    }
    block = {
      label: {
        trackingCode: candidates[0],
        orderId: orderIds[0],
        carrier,
        channel: "TikTok Shop",
        pages: [page],
      },
      hasProducts,
    };
  };
  const finish = (): SourcePdf => {
    finishBlock();
    const result = [...labels.values()];
    const detectedCarriers = [...new Set(result.map((l) => l.carrier))];
    const detectedChannels = [...new Set(result.map((l) => l.channel))];
    const carrierGroups: SourceCarrierGroup[] = [];
    for (const carrier of detectedCarriers)
      for (const channel of detectedChannels) {
        const group = result.filter(
          (label) => label.carrier === carrier && label.channel === channel,
        );
        if (group.length)
          carrierGroups.push({
            carrier,
            channel,
            shipments: group.length,
            orders: new Set(group.map((l) => l.orderId)).size,
            pages: [...new Set(group.flatMap((l) => l.pages))].sort(
              (a, b) => a - b,
            ),
          });
      }
    if (detectedCarriers.length > 1 || detectedChannels.length > 1)
      errors.push({
        page: 0,
        message: `PDF có nhiều hãng/sàn: ${carrierGroups.map((g) => `${g.channel} / ${g.carrier}: ${g.shipments} vận đơn, trang ${formatSourcePages(g.pages, 6)}`).join("; ")}. Tách mỗi file theo một sàn/hãng. Chọn hãng trên form không tự loại các trang hãng khác.`,
      });
    return {
      hash,
      detectedCarriers,
      detectedChannels,
      carrierGroups,
      pageCount,
      labels: result,
      duplicatePages,
      continuationPages,
      orderCount: new Set(
        result.map((l) => JSON.stringify([l.channel, l.orderId])),
      ).size,
      errors,
    };
  };
  return {
    addPage,
    finish,
    snapshot: (): SourceAnalyzerState => ({
      labels: [...labels.values()],
      errors,
      pageCount,
      duplicatePages,
      continuationPages,
      block,
    }),
  };
}

export function analyzeLabelPages(pages: string[], hash: string): SourcePdf {
  const analyzer = sourceLabelAnalyzer(hash);
  pages.forEach(analyzer.addPage);
  return analyzer.finish();
}

type TextItem = { str: string; transform: number[]; width: number };
export function sourcePageText(items: unknown[]): string {
  const textItems = items.filter(
    (item): item is TextItem =>
      typeof item === "object" && item !== null && "str" in item,
  );
  if (!textItems.some((item) => /SPXVN|OrderSN/i.test(item.str)))
    return textItems.map((item) => item.str).join("\n");
  // PDF drawing order is not reading order. Sort glyphs on the same baseline by
  // x, preserving touching accents and adding spaces only across physical gaps.
  const lines: { y: number; items: TextItem[] }[] = [];
  for (const item of [...textItems].sort(
    (a, b) => b.transform[5] - a.transform[5],
  )) {
    const y = item.transform[5];
    let line = lines.at(-1);
    if (!line || Math.abs(line.y - y) > 1) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines
    .map((line) => {
      const sorted = line.items.sort((a, b) => a.transform[4] - b.transform[4]);
      return sorted
        .map((item, i) => {
          const previous = sorted[i - 1];
          const gap = previous
            ? item.transform[4] - previous.transform[4] - previous.width
            : 0;
          return (gap > 1 ? " " : "") + item.str;
        })
        .join("");
    })
    .join("\n");
}
