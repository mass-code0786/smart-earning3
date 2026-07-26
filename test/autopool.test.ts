import{describe,expect,it}from"vitest";import{readFileSync}from"node:fs";import{resolve}from"node:path";
import{AUTOPOOL_INCOME,AUTOPOOL_LEVEL_CAPACITIES,AUTOPOOL_TOTAL_POSITIONS,autopoolCoordinates}from"@/lib/server/autopool-math";
describe("Global Autopool hybrid matrix",()=>{
 it("has the exact 2→6→18→54→162 capacities and $24.20 maximum",()=>{expect(AUTOPOOL_LEVEL_CAPACITIES).toEqual([2,6,18,54,162]);expect(AUTOPOOL_TOTAL_POSITIONS).toBe(242);expect(AUTOPOOL_INCOME*BigInt(AUTOPOOL_TOTAL_POSITIONS)).toBe(24_200_000n)});
 it("maps FIFO positions level-order and left-to-right",()=>{
  expect(autopoolCoordinates(1)).toEqual({level:1,levelPosition:1,parentPosition:null,childSlot:1});
  expect(autopoolCoordinates(2)).toEqual({level:1,levelPosition:2,parentPosition:null,childSlot:2});
  expect(autopoolCoordinates(3)).toEqual({level:2,levelPosition:1,parentPosition:1,childSlot:1});
  expect(autopoolCoordinates(5)).toEqual({level:2,levelPosition:3,parentPosition:1,childSlot:3});
  expect(autopoolCoordinates(6)).toEqual({level:2,levelPosition:4,parentPosition:2,childSlot:1});
  expect(autopoolCoordinates(8)).toEqual({level:2,levelPosition:6,parentPosition:2,childSlot:3});
  expect(autopoolCoordinates(9)).toEqual({level:3,levelPosition:1,parentPosition:3,childSlot:1});
  expect(autopoolCoordinates(242)).toEqual({level:5,levelPosition:162,parentPosition:80,childSlot:3});
 });
 it("rejects positions outside the independent matrix",()=>{expect(()=>autopoolCoordinates(0)).toThrow();expect(()=>autopoolCoordinates(243)).toThrow()});
 it("integrates only at successful Booster entry creation",()=>{const booster=readFileSync(resolve("lib/server/booster-service.ts"),"utf8");expect(booster.match(/await createAutopoolEntryForBooster\(/g)).toHaveLength(1);expect(booster.lastIndexOf("createAutopoolEntryForBooster")).toBeGreaterThan(booster.indexOf("await placeEntry(client,entry)"))});
 it("selects only one FIFO owner and has no multi-owner placement loop",()=>{const service=readFileSync(resolve("lib/server/autopool-service.ts"),"utf8");expect(service).toContain("ORDER BY q.queue_sequence LIMIT 1 FOR UPDATE OF e");expect(service).not.toMatch(/for\s*\(const owner of owners\)/)});
 it("enforces one global queue row and one global placement per entry",()=>{const migration=readFileSync(resolve("database/migrations/012_global_autopool.sql"),"utf8");expect(migration).toMatch(/entry_id uuid NOT NULL UNIQUE REFERENCES autopool_entries/);expect(migration).toMatch(/UNIQUE\(placed_entry_id\)/);expect(migration).toMatch(/position_id uuid NOT NULL UNIQUE REFERENCES autopool_positions/)});
 it("keeps queue membership, placement, and matrix ownership as independent foreign keys",()=>{const migration=readFileSync(resolve("database/migrations/012_global_autopool.sql"),"utf8");expect(migration).toMatch(/entry_id uuid NOT NULL UNIQUE REFERENCES autopool_entries/);expect(migration).toMatch(/owner_entry_id uuid NOT NULL REFERENCES autopool_entries/);expect(migration).toMatch(/placed_entry_id uuid NOT NULL REFERENCES autopool_entries/)});
});
