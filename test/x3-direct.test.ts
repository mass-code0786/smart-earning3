import{describe,it,expect}from"vitest";import{readFileSync}from"node:fs";import{join}from"node:path";
const root=process.cwd(),source=(p:string)=>readFileSync(join(root,p),"utf8");
describe("canonical direct-referral X3",()=>{
 const service=source("lib/server/x3-direct-service.ts"),migration=source("database/migrations/029_x3_direct_referral_cycles.sql");
 it("uses only permanent direct sponsor authority and no tree search",()=>{expect(service).toContain("FROM referral_relations WHERE user_id=$1");expect(service).not.toMatch(/WITH RECURSIVE|findParent|SPILLOVER|RECYCLE_PENDING|ROOT_PENDING/)});
 it("has immutable three-slot cycles and one slot per package purchase",()=>{expect(migration).toContain("UNIQUE(cycle_id,slot_number)");expect(migration).toContain("buyer_package_purchase_id uuid NOT NULL UNIQUE");expect(migration).toContain("x3_direct_one_active_cycle_idx")});
 it("routes slots one/two to owner and three to owner sponsor without filling that sponsor cycle",()=>{expect(service).toContain("if(slot===3)");expect(service).toContain("disposition=recipient?'PASS_UP':'GENESIS_RETAINED'");expect(service.match(/INSERT INTO x3_direct_cycle_slots/g)).toHaveLength(1)});
 it("applies package qualification holds to every recipient",()=>{expect(service).toContain("x3_package_memberships WHERE user_id=$1 AND package_id=$2");expect(service).toContain("held_at+interval '48 hours'")});
 it("caps and splits genuine income exactly once",()=>{expect(service.match(/creditGrossEarning/g)).toHaveLength(2);expect(service).toContain('incomeType:"X3_PACKAGE"')});
 it("retires legacy recovery from production process list",()=>{expect(source("ecosystem.config.cjs")).not.toContain('worker("smart-earning-x3-recovery"')});
  it("records a deterministic chain-order rollout boundary",()=>{expect(migration).toContain("boundary_block_number");expect(migration).toContain("boundary_log_index");expect(service).toContain("isDirectX3Purchase")});
  it("blocks financial activation until an aligned contract is explicitly selected",()=>{expect(service).toContain("X3_CONTRACT_ALIGNMENT_REQUIRED");expect(service).toContain('mode!=="CONTRACT_ALIGNED"')});
});
