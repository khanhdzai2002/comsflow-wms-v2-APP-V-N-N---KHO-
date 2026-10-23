import { describe, expect, it } from "vitest";
import { verifyRequestOrigin } from "../src/lib/request-origin";

const domain = "onlineportfolio-production-ffe8.up.railway.app";
const request = (
  origin: string | null,
  extras: Record<string, string> = {},
) => ({
  url: "http://internal:8080/api/auth/login",
  headers: new Headers({
    host: "internal:8080",
    ...(origin ? { origin } : {}),
    ...extras,
  }),
});

describe("Origin validation behind Railway HTTPS proxy", () => {
  it("uses Railway's public domain despite internal HTTP and host", () => {
    expect(() =>
      verifyRequestOrigin(request(`https://${domain}`), {
        railwayPublicDomain: domain,
      }),
    ).not.toThrow();
  });
  it("normalizes configured origin whitespace, case and trailing slash", () => {
    expect(() =>
      verifyRequestOrigin(request(`https://${domain}`), {
        appOrigin: `  HTTPS://${domain.toUpperCase()}/  `,
      }),
    ).not.toThrow();
  });
  it("accepts Railway's hostname even when APP_ORIGIN refers to another deployment", () => {
    expect(() =>
      verifyRequestOrigin(request(`https://${domain}`), {
        appOrigin: "https://old.example",
        railwayPublicDomain: domain,
      }),
    ).not.toThrow();
  });
  it("accepts a separately configured custom HTTPS domain", () => {
    expect(() =>
      verifyRequestOrigin(request("https://warehouse.example"), {
        appOrigin: "https://warehouse.example/",
        railwayPublicDomain: domain,
      }),
    ).not.toThrow();
  });
  it.each([
    "https://evil.example",
    `https://${domain}.evil.example`,
    `http://${domain}`,
    "null",
    null,
  ])("rejects a foreign, downgraded or missing origin: %s", (origin) => {
    expect(() =>
      verifyRequestOrigin(request(origin), { railwayPublicDomain: domain }),
    ).toThrow("Nguồn yêu cầu");
  });
  it("does not allow attacker-supplied forwarded host or proto", () => {
    expect(() =>
      verifyRequestOrigin(
        request("https://evil.example", {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        }),
        { railwayPublicDomain: domain },
      ),
    ).toThrow();
  });
  it("rejects browser requests marked cross-site", () => {
    expect(() =>
      verifyRequestOrigin(
        request(`https://${domain}`, { "sec-fetch-site": "cross-site" }),
        { railwayPublicDomain: domain },
      ),
    ).toThrow();
  });
  it("keeps same-origin local development working", () => {
    const local = {
      url: "http://localhost:3000/api/scans",
      headers: new Headers({
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      }),
    };
    expect(() => verifyRequestOrigin(local)).not.toThrow();
    expect(() =>
      verifyRequestOrigin({
        ...local,
        headers: new Headers({
          host: "127.0.0.1:3000",
          origin: "http://evil.example",
        }),
      }),
    ).toThrow();
  });
  it("fails closed for malformed configuration rather than trusting request headers", () => {
    expect(() =>
      verifyRequestOrigin(request("http://internal:8080"), {
        appOrigin: "not-a-url",
      }),
    ).toThrow();
  });
});
