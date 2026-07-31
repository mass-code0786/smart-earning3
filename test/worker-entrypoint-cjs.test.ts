// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { transform } from "esbuild";
import { describe, expect, it } from "vitest";

const workers = [
  "booster-worker.ts",
  "dividend-worker.ts",
  "indexer.ts",
  "magic-funding-worker.ts",
  "withdrawal-worker.ts",
  "x3-recovery-worker.ts",
] as const;

describe("production PM2 worker CommonJS compatibility", () => {
  it.each(workers)("transforms scripts/%s without top-level await", async (worker) => {
    const source = await readFile(resolve("scripts", worker), "utf8");
    const result = await transform(source, {
      format: "cjs",
      loader: "ts",
      platform: "node",
      target: "node20",
    });
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain("require(");
  });
});
