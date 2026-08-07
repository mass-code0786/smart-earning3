import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(file), "utf8");

describe("package-only 5X earning-cap policy", () => {
  it("creates no registration or genesis cap principal", () => {
    const contract = read("contracts/SmartEarning.sol");
    const registration = read("lib/server/registration-service.ts");
    const genesis = read("lib/server/genesis-bootstrap.ts");
    expect(contract).not.toMatch(/totalEarningCap\[[^\]]+\]\s*=\s*registrationPrice\s*\*\s*5/);
    expect(contract).not.toMatch(/totalEligibleValue\[[^\]]+\]\s*=\s*registrationPrice/);
    expect(registration).not.toMatch(/source_type[^\n]+REGISTRATION/);
    expect(registration).toContain("sponsorEarningCap !== sponsorPackageValue * 5n");
    expect(genesis).not.toMatch(/earning_cap_ledger|registrationValueInput\s*\*\s*5/);
  });

  it("derives every successful package cap from cumulative package principal", () => {
    const service = read("lib/server/package-service.ts");
    expect(service).toContain("newCap !== totalPackageValue * 5n");
    expect(service).toContain("total_eligible_value=$3,total_earning_cap=$4");
    expect(service).not.toContain("total_eligible_value=registration_value+$3");
  });
});
