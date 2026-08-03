// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.join(process.cwd(), "app/dashboard.css"), "utf8");

describe("authenticated application glass opacity", () => {
  it("uses one moderate surface token for shared cards and legacy glass containers", () => {
    expect(css).toContain("--se-glass-surface: rgba(4, 13, 10, 0.34)");
    expect(css).toMatch(/\.glass-card,[\s\S]*?background: var\(--se-glass-surface\)/);
    expect(css).toMatch(/\.smart-internal-shell \.glass,[\s\S]*?background-color: var\(--se-glass-surface\) !important/);
    expect(css).toMatch(/\.dashboard-theme \.action-pill \{[\s\S]*?background: var\(--se-glass-surface\)/);
  });

  it("keeps navigation as the only stronger structural glass surface", () => {
    expect(css).toContain("--se-navigation-surface: rgba(4, 13, 10, 0.72)");
    expect(css).toMatch(/\.dashboard-theme \.dash-sidebar,[\s\S]*?background: var\(--se-navigation-surface\)/);
  });

  it("normalizes custom authenticated content boxes through the shared token", () => {
    for (const selector of [
      ".home-team-summary", ".home-action-card", ".home-matrix-card", ".home-state-card",
      ".member-card", ".team-filters > label", ".history-drawer nav > a",
      ".history-filter-fields select", ".full-tree-canvas", ".wallet-summary-page .smart-glass-card",
      ".income-type-card",
    ]) expect(css).toContain(selector);
    expect(css).toContain('[class*="bg-black/10"]');
    expect(css).toContain('[class*="bg-black/20"]');
  });

  it("covers every authenticated product surface without page-level CSS changes", () => {
    const surfaces = [
      "components/real-dashboard.tsx", "components/live-plan-data.tsx", "components/x3-page.tsx",
      "components/x4-page.tsx", "components/booster-page.tsx", "components/autopool-page.tsx",
      "components/real-team.tsx", "components/real-wallet.tsx", "components/history-page.tsx",
      "components/matrix-history-menu.tsx",
    ];
    for (const file of surfaces) {
      expect(fs.readFileSync(path.join(process.cwd(), file), "utf8")).toMatch(/smart-glass-card|matrix-history-sheet|home-(?:team-summary|action-card|matrix-card)/);
    }
  });
});
