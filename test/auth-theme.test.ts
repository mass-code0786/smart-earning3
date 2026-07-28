import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

describe("landing/login dashboard token reuse", () => {
  it("reuses the dashboard accent, glass border, and dark background", () => {
    expect(css).toContain("--se-accent:#00f77a");
    expect(css).toContain("background:#020705");
    expect(css).toContain("border-color:rgba(0,247,122,.22)");
  });

  it("keeps the login card inside a 341px mobile viewport", () => {
    expect(css).toContain("max-width:100vw");
    expect(css).toContain("grid-template-columns:minmax(0,1fr)");
    expect(css).toContain(".auth-card{min-width:0;width:100%;max-width:448px");
    expect(css).toContain("@media(max-width:370px)");
    expect(css).toContain(".auth-frame{padding-left:10px;padding-right:10px}");
  });

  it("uses a full dynamic viewport layout for Wallet Login only", () => {
    expect(css).toContain(".auth-login-frame{min-height:100dvh");
    expect(css).toContain(".auth-login-card{display:flex;min-height:calc(100dvh");
    expect(css).toContain("max-width:none");
  });
});
