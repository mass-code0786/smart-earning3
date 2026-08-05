// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("matrix history menu placement", () => {
  it("is present on every supported existing matrix/module card", () => {
    expect(read("components/magic-level-structure.tsx")).toContain('<MatrixHistoryMenu module="MAGIC_LEVEL"');
    expect(read("components/x3-page.tsx")).toContain('<MatrixHistoryMenu module="X3"');
    expect(read("components/x4-page.tsx")).toContain('<MatrixHistoryMenu module="X4"');
    expect(read("components/booster-page.tsx")).toContain('<MatrixHistoryMenu module="BOOSTER"');
    expect(read("components/autopool-page.tsx")).toContain('<MatrixHistoryMenu module="AUTOPOOL"');
  });
});
