import { afterEach, describe, expect, it } from "vitest";
import { sessionCookieOptions } from "@/lib/server/auth";
import { ServerConfigError, validateAuthEnvironment } from "@/lib/server/config";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("wallet auth environment", () => {
  it("reports the exact missing auth variables", () => {
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    process.env.APP_ORIGIN = "http://localhost:3000";
    try {
      validateAuthEnvironment();
      throw new Error("validation should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerConfigError);
      expect((error as ServerConfigError).missingOrInvalid).toEqual(
        expect.arrayContaining(["DATABASE_URL", "SESSION_SECRET"]),
      );
    }
  });

  it("does not mark the localhost development session cookie Secure", () => {
    expect(sessionCookieOptions("http://localhost:3000", "development")).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
    });
  });

  it("keeps production cookies Secure", () => {
    expect(sessionCookieOptions("https://app.example.com", "production").secure).toBe(true);
  });

  it("allows a production build to be verified on HTTP localhost", () => {
    expect(sessionCookieOptions("http://localhost:3000", "production").secure).toBe(false);
  });
});
