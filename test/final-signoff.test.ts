import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const root = process.cwd();
const browserEvidence = path.join(
  root,
  "evidence/final-browser-audit/console-network-report.json",
);

test("X3 recovery migration supports terminal audited classification", () => {
  const sql = fs.readFileSync(
    path.join(root, "database/migrations/020_x3_recovery_classification.sql"),
    "utf8",
  );
  expect(sql).toMatch(/STALE/);
  expect(sql).toMatch(/INVALID/);
  expect(sql).toMatch(/failure_classification/);
  expect(sql).toMatch(/sanitized_error/);
});

test("X3 recovery audit defaults to read-only classification", () => {
  const script = fs.readFileSync(
    path.join(root, "scripts/x3-recovery-audit.ts"),
    "utf8",
  );
  expect(script).toMatch(/classify-stale/);
  expect(script).toMatch(/READ_ONLY/);
  expect(script).not.toMatch(/DELETE FROM x3_pending_allocations/i);
});

test("browser sign-off covers required viewports and authenticated routes", () => {
  const script = fs.readFileSync(
    path.join(root, "scripts/frontend-browser-audit.ts"),
    "utf8",
  );
  for (const viewport of ["320", "360", "390", "412", "768", "1440"]) {
    expect(script).toMatch(new RegExp(`width:\\s*${viewport}`));
  }
  for (const route of [
    "/dashboard",
    "/packages",
    "/matrix/x3",
    "/matrix/x4",
    "/magic-level",
    "/booster",
    "/autopool",
    "/dividend",
    "/income",
    "/team",
    "/wallet",
    "/admin",
  ]) {
    expect(script, `missing browser route ${route}`).toContain(route);
  }
});

const browserEvidenceTest = fs.existsSync(browserEvidence) ? test : test.skip;
browserEvidenceTest("browser evidence has no unexplained errors or layout overflow", () => {
  const report = JSON.parse(
    fs.readFileSync(browserEvidence, "utf8"),
  ) as {
    routes: Array<{ overflow: boolean }>;
    consoleErrors: Array<{ route: string }>;
    networkFailures: Array<{ route: string }>;
    expectedFailures: Array<{ route: string }>;
  };
  expect(report.routes.filter((route) => route.overflow)).toHaveLength(0);
  const expectedRoutes = new Set(
    report.expectedFailures.map((failure) => `${failure.route}?state=error`),
  );
  expect(
    report.consoleErrors.filter((failure) => !expectedRoutes.has(failure.route)),
  ).toHaveLength(0);
  expect(
    report.networkFailures.filter(
      (failure) => !expectedRoutes.has(failure.route),
    ),
  ).toHaveLength(0);
});
