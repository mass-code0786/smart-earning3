// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("real-wallet-only entry points", () => {
  it("offers wallet login and registration without a demo dashboard bypass", () => {
    const landing = read("app/page.tsx");
    expect(landing).toContain('href="/login"');
    expect(landing).toContain('href="/register"');
    expect(landing).not.toContain("Open Demo");
    expect(landing).not.toContain('href="/dashboard"');
  });

  it("renders the dashboard from the authenticated API without mock balances", () => {
    const dashboard = read("components/real-dashboard.tsx");
    expect(dashboard).toContain('json("/api/dashboard")');
    expect(dashboard).not.toContain("$1,248.50");
    expect(dashboard).not.toContain("$246.80");
    expect(dashboard).not.toContain("SE123456");
  });
});
