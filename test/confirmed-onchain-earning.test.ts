// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const applyIncomeCap = vi.hoisted(() => vi.fn());
const enqueueAutomaticWithdrawal = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/server/income-cap-service", () => ({ creditIncomeWithCap: applyIncomeCap }));
vi.mock("@/lib/server/withdrawal-service", () => ({ enqueueAutomaticWithdrawal }));

import { creditGrossEarning } from "@/lib/server/earning-split-service";

describe("confirmed on-chain registration earning projection", () => {
  it("records the event-authoritative capped amount with the unchanged split", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const client = { query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (text.startsWith("SELECT id,income_credit_ledger_id")) return { rows: [] };
      if (text.startsWith("SELECT total_earning_cap")) {
        return { rows: [{ total_earning_cap: "10000000", total_earned: "0" }] };
      }
      if (text.startsWith("INSERT INTO income_credit_ledger")) return { rows: [{ id: "cap-ledger" }] };
      if (text.startsWith("INSERT INTO earning_split_events")) return { rows: [{ id: "split" }] };
      if (text.startsWith("INSERT INTO magic_funding_events")) return { rows: [{ id: "funding" }] };
      if (text.startsWith("INSERT INTO magic_wallet_ledger")) return { rows: [{ id: "magic" }] };
      return { rows: [] };
    }) };

    await expect(creditGrossEarning({
      userId: "sponsor", incomeType: "DIRECT_INCOME", sourceReference: "registration",
      grossAmount: 1_000_000n, confirmedOnchainCredit: 1_000_000n,
      idempotencyKey: "registration:tx:direct-cap", magicAlreadyOnchain: true,
    }, client as never)).resolves.toMatchObject({
      credited: 1_000_000n, magic: 100_000n, income: 900_000n, duplicate: false,
    });

    expect(applyIncomeCap).not.toHaveBeenCalled();
    const split = calls.find(call => call.text.startsWith("INSERT INTO earning_split_events"));
    expect(split?.values).toEqual(expect.arrayContaining(["100000", "900000"]));
    expect(calls.some(call => call.text.startsWith("UPDATE user_package_states"))).toBe(true);
  });
});
