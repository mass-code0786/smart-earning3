import { diagnoseUserOwnership } from "./user-ownership-diagnostic";
import { ownershipRepairPlan } from "./user-ownership-repair";

type Diagnostic = Awaited<ReturnType<typeof diagnoseUserOwnership>>;
type RepairPlan = ReturnType<typeof ownershipRepairPlan>;

export function ownershipDiagnosticSummary(
  diagnostic: Diagnostic,
  safetyError: string | null = null,
) {
  return {
    mode: "DRY_RUN",
    eventDiscovery: {
      lookups: diagnostic.eventDiscovery.lookups,
      candidateTransactionHashes: diagnostic.eventDiscovery.candidateTransactionHashes,
      candidateReceipts: diagnostic.eventDiscovery.candidateReceipts,
      decodedUserRegisteredEvents: diagnostic.eventDiscovery.decodedUserRegisteredEvents,
      matchingConfirmedEvents: diagnostic.eventDiscovery.matchingConfirmedEvents,
      lookupFailures: diagnostic.eventDiscovery.lookupFailures,
      conclusion: diagnostic.eventDiscovery.conclusion,
    },
    users: diagnostic.users,
    registrations: diagnostic.registrations,
    referralRelations: diagnostic.referralRelations,
    blockchainTransactions: diagnostic.blockchainTransactions,
    processedBlockchainEvents: diagnostic.processedBlockchainEvents,
    mismatches: diagnostic.mismatches,
    safetyError,
  };
}

export function printDiagnosticThenCreateRepairPlan(
  diagnostic: Diagnostic,
  write: (output: string) => void,
): RepairPlan {
  write(`${JSON.stringify(ownershipDiagnosticSummary(diagnostic), null, 2)}\n`);
  try {
    return ownershipRepairPlan(diagnostic);
  } catch (error) {
    const safetyError = error instanceof Error ? error.message : String(error);
    write(`${JSON.stringify(ownershipDiagnosticSummary(diagnostic, safetyError), null, 2)}\n`);
    throw error;
  }
}
