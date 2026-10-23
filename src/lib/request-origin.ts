import { AppError } from "./domain";

function canonicalOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Use configured public origins; never trust arbitrary forwarded host headers. */
export function verifyRequestOrigin(
  request: { url: string; headers: Headers },
  config: { appOrigin?: string; railwayPublicDomain?: string } = {},
) {
  const rawOrigin = request.headers.get("origin");
  const origin = canonicalOrigin(rawOrigin);
  const allowed = new Set<string>();
  const configured = canonicalOrigin(config.appOrigin);
  if (configured) allowed.add(configured);

  // Railway supplies this hostname independently of browser-controlled headers.
  const railwayDomain = config.railwayPublicDomain?.trim();
  if (
    railwayDomain &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(railwayDomain)
  ) {
    const railwayOrigin = canonicalOrigin(`https://${railwayDomain}`);
    if (railwayOrigin) allowed.add(railwayOrigin);
  }

  // Direct local/self-hosted requests without configured public origins.
  // Behind an HTTPS reverse proxy, explicitly configure APP_ORIGIN instead.
  if (!config.appOrigin?.trim() && !railwayDomain) {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    const directOrigin = canonicalOrigin(`${url.protocol}//${host}`);
    if (directOrigin) allowed.add(directOrigin);
  }

  if (
    !origin ||
    !allowed.has(origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new AppError(
      403,
      "Nguồn yêu cầu không hợp lệ. Kiểm tra APP_ORIGIN và domain đang truy cập.",
    );
  }
}
