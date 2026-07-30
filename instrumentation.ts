export async function register(){
  if(process.env.NEXT_RUNTIME==="nodejs"&&process.env.NEXT_PHASE!=="phase-production-build"){
    const{validateAuthEnvironment,ServerConfigError}=await import("./lib/server/config");
    try{
      validateAuthEnvironment();
    }catch(error){
      if(error instanceof ServerConfigError){
        console.error(`[startup] ${error.message}. Set the listed variables in .env before wallet login.`);
      }else{
        throw error;
      }
    }
    try{
      const{verifyDatabaseStartup}=await import("./lib/server/db");
      await verifyDatabaseStartup();
    }catch(error){
      const{classifyDatabaseError}=await import("./lib/server/db");
      const diagnostic=classifyDatabaseError(error);
      console.error(`[startup:database:${diagnostic.databaseCode}] ${diagnostic.message}`);
    }
    const{startX3RecoveryWorker}=await import("./lib/server/x3-recovery-worker");
    startX3RecoveryWorker();
    const{startBlockchainIndexer}=await import("./lib/server/blockchain-indexer");
    startBlockchainIndexer();
  }
}
