import { writeFile } from "node:fs/promises";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { getPool } from "../lib/server/db";
import { auditX3Recovery, classifyStaleRecoveryMetadata } from "../lib/server/x3-recovery-audit-service";
loadAuthoritativeEnvironment(process.cwd());

async function main(){
  const repair=process.argv.includes("--classify-stale");
  if(repair)await classifyStaleRecoveryMetadata();
  const report=await auditX3Recovery();
  await writeFile("evidence/x3-recovery-audit.json",JSON.stringify({...report,mode:repair?"CLASSIFY_STALE_METADATA":"READ_ONLY"},null,2));
  process.stdout.write(JSON.stringify({mode:repair?"CLASSIFY_STALE_METADATA":"READ_ONLY",...report.counts,artifact:"evidence/x3-recovery-audit.json"},null,2)+"\n");
  await getPool().end();
  if(report.counts.inconsistent>0)process.exitCode=2;
}
void main().catch(async error=>{console.error(JSON.stringify({error:error instanceof Error?error.message:"X3 recovery audit failed",secretsSuppressed:true}));await getPool().end().catch(()=>undefined);process.exitCode=1});
