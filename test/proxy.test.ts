// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { config, proxy } from "@/proxy";

const originalSecret = process.env.SESSION_SECRET;
const secret = "test-only-proxy-secret-at-least-32-characters";
const admin = "0x000000000000000000000000000000000000dead";

afterEach(() => {
  process.env.SESSION_SECRET = originalSecret;
  delete process.env.ADMIN_WALLETS;
});

describe("protected wallet routes", () => {
  it("redirects every protected route family when no session exists", async () => {
    process.env.SESSION_SECRET = secret;
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico|logo.png).*)"]);
    const response = await proxy(new NextRequest("http://localhost:3000/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("allows a valid server session and rejects an expired one", async () => {
    process.env.SESSION_SECRET = secret;
    const valid = await new SignJWT({ chainId: 97 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("0x000000000000000000000000000000000000dead")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    const allowed = await proxy(new NextRequest("http://localhost:3000/packages", {
      headers: { cookie: `se_session=${valid}` },
    }));
    expect(allowed.status).toBe(200);

    const expired = await new SignJWT({ chainId: 97 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("0x000000000000000000000000000000000000dead")
      .setExpirationTime(0)
      .sign(new TextEncoder().encode(secret));
    const denied = await proxy(new NextRequest("http://localhost:3000/wallet", {
      headers: { cookie: `se_session=${expired}` },
    }));
    expect(denied.status).toBe(307);
    expect(denied.cookies.get("se_session")?.value).toBe("");
  });

  it("protects the admin page with the canonical allowlist", async () => {
    process.env.SESSION_SECRET = secret;
    process.env.ADMIN_WALLETS = admin;
    const allowedToken = await new SignJWT({ chainId: 97 }).setProtectedHeader({ alg: "HS256" })
      .setSubject(admin).setExpirationTime("1h").sign(new TextEncoder().encode(secret));
    expect((await proxy(new NextRequest("http://localhost:3000/admin", {
      headers: { cookie: `se_session=${allowedToken}` },
    }))).status).toBe(200);
    const deniedToken = await new SignJWT({ chainId: 97 }).setProtectedHeader({ alg: "HS256" })
      .setSubject("0x1111111111111111111111111111111111111111").setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    expect((await proxy(new NextRequest("http://localhost:3000/admin", {
      headers: { cookie: `se_session=${deniedToken}` },
    }))).status).toBe(307);
  });
});
