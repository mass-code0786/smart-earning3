import{loadAuthoritativeEnvironment}from"../lib/server/production-environment";
import{getPool}from"../lib/server/db";
import{startX3RecoveryWorker}from"../lib/server/x3-recovery-worker";
loadAuthoritativeEnvironment(process.cwd());
const worker=startX3RecoveryWorker();if(!worker)throw new Error("X3 recovery worker is disabled");const ownedWorker=worker;
async function stop(){ownedWorker.stop();await getPool().end().catch(()=>undefined);process.exit(0)}
process.once("SIGINT",()=>void stop());process.once("SIGTERM",()=>void stop());
