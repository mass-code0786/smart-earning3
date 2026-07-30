import { Interface } from "ethers";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { getProvider } from "@/lib/blockchain/provider";
import { getServerConfig } from "./config";
import { normalizeWallet } from "./auth";
import { query } from "./db";

const iface = new Interface(SMART_EARNING_ABI);

export async function diagnoseUserOwnership(sponsorInput: string, referralInput: string) {
  const sponsor = normalizeWallet(sponsorInput);
  const referral = normalizeWallet(referralInput);
  if (sponsor === referral) throw new Error("Sponsor and referral must be different wallets");

  const duplicates = await query<{
    normalized_wallet: string; row_count: number; ids: string[]; wallets: string[];
  }>(
    `SELECT lower(wallet_address) normalized_wallet,count(*)::int row_count,
            array_agg(id::text ORDER BY created_at) ids,
            array_agg(wallet_address ORDER BY created_at) wallets
     FROM users WHERE lower(wallet_address) IN(lower($1),lower($2))
     GROUP BY lower(wallet_address) HAVING count(*)>1`,
    [sponsor, referral],
  );
  const users = await query<{
    id: string; wallet_address: string; direct_count: number; created_at: Date;
    sponsor_user_id: string | null; sponsor_wallet: string | null;
    registration_id: string | null; registration_tx_hash: string | null;
    registration_status: string | null;
  }>(
    `SELECT u.id,u.wallet_address,u.direct_count,u.created_at,
            rr.sponsor_user_id,sp.wallet_address sponsor_wallet,
            r.id registration_id,r.tx_hash registration_tx_hash,r.status registration_status
     FROM users u
     LEFT JOIN referral_relations rr ON rr.user_id=u.id
     LEFT JOIN users sp ON sp.id=rr.sponsor_user_id
     LEFT JOIN registrations r ON r.user_id=u.id
     WHERE lower(u.wallet_address) IN(lower($1),lower($2))
     ORDER BY u.created_at,u.id`,
    [sponsor, referral],
  );
  const byWallet = new Map(users.rows.map((row) => [row.wallet_address.toLowerCase(), row]));
  const sponsorUser = byWallet.get(sponsor);
  const referralUser = byWallet.get(referral);
  const mismatches: string[] = [];
  if (duplicates.rows.length) mismatches.push("DUPLICATE_WALLET_ROWS");
  if (!sponsorUser) mismatches.push("SPONSOR_USER_NOT_FOUND");
  if (!referralUser) mismatches.push("REFERRAL_USER_NOT_FOUND");
  if (users.rows.length !== 2) mismatches.push("AMBIGUOUS_USER_MAPPING");

  const userIds = users.rows.map((row) => row.id);
  const [
    relations, teamTotals, x3Ownership, registrations, matrixPlacements, packagePurchases,
    activities, blockchainTransactions, processedEvents, financialTotals, ledgerRows,
  ] = await Promise.all([
    query(
      `SELECT rr.*,child.wallet_address referral_wallet,sp.wallet_address sponsor_wallet
       FROM referral_relations rr JOIN users child ON child.id=rr.user_id
       JOIN users sp ON sp.id=rr.sponsor_user_id
       WHERE rr.user_id=ANY($1::uuid[]) OR rr.sponsor_user_id=ANY($1::uuid[])
       ORDER BY rr.created_at,rr.id`,
      [userIds],
    ),
    query(
      `WITH RECURSIVE team(root_user_id,user_id) AS (
         SELECT root.id,rr.user_id FROM users root
         JOIN referral_relations rr ON rr.sponsor_user_id=root.id
         WHERE root.id=ANY($1::uuid[])
         UNION
         SELECT team.root_user_id,rr.user_id FROM team
         JOIN referral_relations rr ON rr.sponsor_user_id=team.user_id
       )
       SELECT u.id user_id,u.wallet_address,
         (SELECT count(*)::int FROM referral_relations rr WHERE rr.sponsor_user_id=u.id)
           recomputed_direct_count,
         (SELECT count(*)::int FROM team WHERE team.root_user_id=u.id) total_team
       FROM users u WHERE u.id=ANY($1::uuid[]) ORDER BY u.id`,
      [userIds],
    ),
    query(
      `SELECT h.id hold_id,h.user_id current_user_id,i.owner_user_id expected_user_id,
              c.user_id cycle_owner_user_id,h.package_id,h.amount::text,h.status,
              i.source_package_purchase_id,i.slot_id,i.idempotency_key,
              pp.user_id source_purchase_user_id,mp.user_id matrix_placed_user_id
       FROM x3_hold_ledger h
       JOIN x3_income_ledger i ON i.id=h.x3_income_ledger_id
       JOIN x3_cycles c ON c.id=i.owner_cycle_id
       LEFT JOIN package_purchases pp ON pp.id=i.source_package_purchase_id
       LEFT JOIN matrix_placements mp ON mp.user_id=i.owner_user_id
       WHERE h.user_id=ANY($1::uuid[]) OR i.owner_user_id=ANY($1::uuid[])
       ORDER BY h.held_at,h.id`,
      [userIds],
    ),
    query(
      `SELECT r.*,u.wallet_address registered_wallet,sp.wallet_address sponsor_wallet
       FROM registrations r JOIN users u ON u.id=r.user_id
       JOIN users sp ON sp.id=r.sponsor_user_id
       WHERE r.user_id=ANY($1::uuid[]) OR r.sponsor_user_id=ANY($1::uuid[])
       ORDER BY r.created_at,r.id`,
      [userIds],
    ),
    query(
      `SELECT mp.*,u.wallet_address placed_wallet,p.wallet_address parent_wallet
       FROM matrix_placements mp JOIN users u ON u.id=mp.user_id
       LEFT JOIN users p ON p.id=mp.parent_user_id
       WHERE mp.user_id=ANY($1::uuid[]) OR mp.parent_user_id=ANY($1::uuid[])
       ORDER BY mp.created_at,mp.id`,
      [userIds],
    ),
    query(
      `SELECT pp.*,u.wallet_address FROM package_purchases pp
       JOIN users u ON u.id=pp.user_id WHERE pp.user_id=ANY($1::uuid[])
       ORDER BY pp.created_at,pp.id`,
      [userIds],
    ),
    query(
      `SELECT * FROM activity_history
       WHERE user_id=ANY($1::uuid[]) OR source_user_id=ANY($1::uuid[])
          OR lower(user_wallet) IN(lower($2),lower($3))
       ORDER BY occurred_at,id`,
      [userIds, sponsor, referral],
    ),
    query(
      `SELECT * FROM blockchain_transactions
       WHERE lower(from_address) IN(lower($1),lower($2))
          OR lower(raw_payload->>'user') IN(lower($1),lower($2))
          OR lower(raw_payload->>'sponsor') IN(lower($1),lower($2))
          OR lower(raw_payload->>'matrixParent') IN(lower($1),lower($2))
          OR lower(tx_hash) IN(
            SELECT lower(r.tx_hash) FROM registrations r
            WHERE r.user_id=ANY($3::uuid[]) OR r.sponsor_user_id=ANY($3::uuid[])
          )
       ORDER BY created_at,id`,
      [sponsor, referral, userIds],
    ),
    query(
      `SELECT pe.* FROM blockchain_processed_events pe
       WHERE pe.event_name='UserRegistered' AND (
         lower(pe.transaction_hash) IN(
           SELECT lower(r.tx_hash) FROM registrations r
           WHERE r.user_id=ANY($3::uuid[]) OR r.sponsor_user_id=ANY($3::uuid[])
         )
         OR EXISTS(
           SELECT 1 FROM blockchain_transactions bt
           WHERE bt.chain_id=pe.chain_id
             AND lower(bt.tx_hash)=lower(pe.transaction_hash)
             AND (
               lower(bt.from_address) IN(lower($1),lower($2))
               OR lower(bt.raw_payload->>'user') IN(lower($1),lower($2))
               OR lower(bt.raw_payload->>'sponsor') IN(lower($1),lower($2))
               OR lower(bt.raw_payload->>'matrixParent') IN(lower($1),lower($2))
             )
         )
       )
       ORDER BY pe.block_number,pe.log_index`,
      [sponsor, referral, userIds],
    ),
    query(
      `SELECT u.id user_id,u.wallet_address,
        (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0)::text
         FROM income_wallet_ledger WHERE user_id=u.id) income_wallet,
        (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text
         FROM magic_wallet_ledger WHERE user_id=u.id) magic_wallet,
        (SELECT COALESCE(sum(amount),0)::text FROM x3_hold_ledger
         WHERE user_id=u.id AND status='HELD') x3_hold_wallet,
        (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text
         FROM booster_wallet_ledger WHERE user_id=u.id) booster_wallet,
        (SELECT COALESCE(sum(capped_gross_credit),0)::text FROM earning_split_events
         WHERE user_id=u.id) total_earned,
        (SELECT COALESCE(sum(amount),0)::text FROM daily_dividend_allocations
         WHERE user_id=u.id) dividend_income
       FROM users u WHERE u.id=ANY($1::uuid[]) ORDER BY u.created_at,u.id`,
      [userIds],
    ),
    query(
      `SELECT 'income_wallet_ledger' source,id::text,user_id,amount::text amount,
              reason category,idempotency_key,created_at FROM income_wallet_ledger
       WHERE user_id=ANY($1::uuid[])
       UNION ALL
       SELECT 'magic_wallet_ledger',id::text,user_id,amount_token_units::text,reason,idempotency_key,created_at
       FROM magic_wallet_ledger WHERE user_id=ANY($1::uuid[])
       UNION ALL
       SELECT 'x3_hold_ledger',id::text,user_id,amount::text,status,id::text,held_at
       FROM x3_hold_ledger WHERE user_id=ANY($1::uuid[])
       UNION ALL
       SELECT 'earning_split_events',id::text,user_id,capped_gross_credit::text,income_type,idempotency_key,created_at
       FROM earning_split_events WHERE user_id=ANY($1::uuid[])
       UNION ALL
       SELECT 'income_credit_ledger',id::text,user_id,credited_amount::text,income_type,idempotency_key,created_at
       FROM income_credit_ledger WHERE user_id=ANY($1::uuid[])
       UNION ALL
       SELECT 'magic_funding_events',id::text,user_id,amount::text,source_type,idempotency_key,created_at
       FROM magic_funding_events WHERE user_id=ANY($1::uuid[])
       UNION ALL
       SELECT 'direct_income_ledger',id::text,sponsor_user_id,amount_token_units::text,
              'DIRECT_INCOME',idempotency_key,created_at
       FROM direct_income_ledger
       WHERE sponsor_user_id=ANY($1::uuid[]) OR source_user_id=ANY($1::uuid[])
       ORDER BY created_at,source,id`,
      [userIds],
    ),
  ]);

  if (referralUser && referralUser.sponsor_wallet?.toLowerCase() !== sponsor) {
    mismatches.push("REFERRAL_SPONSOR_MISMATCH");
  }
  const hashSources = new Map<string, Set<string>>();
  const addCandidate = (value: unknown, source: string) => {
    const hash = String(value || "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(hash)) return;
    const sources = hashSources.get(hash) || new Set<string>();
    sources.add(source);
    hashSources.set(hash, sources);
  };
  for (const row of registrations.rows as Array<Record<string, unknown>>) {
    addCandidate(row.tx_hash, "registration tx hash");
  }
  for (const row of blockchainTransactions.rows as Array<Record<string, unknown>>) {
    addCandidate(row.tx_hash, "blockchain_transactions");
  }
  for (const row of processedEvents.rows as Array<Record<string, unknown>>) {
    addCandidate(row.transaction_hash, "processed blockchain events");
  }
  const candidateTransactionHashes = [...hashSources].map(([transactionHash, sources]) => ({
    transactionHash,
    sources: [...sources].sort(),
  }));
  const provider = getProvider();
  let latestBlock: number | null = null;
  const requiredConfirmations = getServerConfig().CONFIRMATIONS_REQUIRED;
  const configuredContract = normalizeWallet(getServerConfig().SMART_EARNING_CONTRACT_ADDRESS);
  const decodedUserRegisteredEvents: Array<Record<string, unknown>> = [];
  const candidateReceipts: Array<Record<string, unknown>> = [];
  const lookupFailures: Array<Record<string, unknown>> = [];
  let receiptsFound = 0;
  if (candidateTransactionHashes.length) {
    try {
      latestBlock = await provider.getBlockNumber();
    } catch (error) {
      lookupFailures.push({
        lookup: "transaction receipt",
        reason: `Latest block lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  for (const candidate of candidateTransactionHashes) {
    let transaction;
    let receipt;
    const receiptDiagnostic: Record<string, unknown> = {
      transactionHash: candidate.transactionHash,
      sources: candidate.sources,
      transactionFetchStatus: "PENDING",
      receiptFetchStatus: "PENDING",
      receiptStatus: null,
      transactionSender: null,
      destinationContract: null,
      confirmations: null,
      decodedUserRegisteredEventCount: 0,
      rejectionReasons: [],
    };
    candidateReceipts.push(receiptDiagnostic);
    try {
      [transaction, receipt] = await Promise.all([
        provider.getTransaction(candidate.transactionHash),
        provider.getTransactionReceipt(candidate.transactionHash),
      ]);
    } catch (error) {
      receiptDiagnostic.transactionFetchStatus = "FAILED";
      receiptDiagnostic.receiptFetchStatus = "FAILED";
      receiptDiagnostic.rejectionReasons = ["receipt failed"];
      lookupFailures.push({
        transactionHash: candidate.transactionHash,
        lookup: "transaction receipt",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    receiptDiagnostic.transactionFetchStatus = transaction ? "FOUND" : "NOT_FOUND";
    receiptDiagnostic.receiptFetchStatus = receipt ? "FOUND" : "NOT_FOUND";
    receiptDiagnostic.transactionSender = transaction
      ? normalizeWallet(transaction.from)
      : null;
    receiptDiagnostic.destinationContract = transaction?.to
      ? normalizeWallet(transaction.to)
      : null;
    if (!transaction) {
      lookupFailures.push({
        transactionHash: candidate.transactionHash, lookup: "registration tx hash",
        reason: "Transaction was not found by the configured chain RPC",
      });
    }
    if (!receipt) {
      receiptDiagnostic.rejectionReasons = ["receipt failed"];
      lookupFailures.push({
        transactionHash: candidate.transactionHash, lookup: "transaction receipt",
        reason: "Receipt was not found by the configured chain RPC",
      });
      continue;
    }
    receiptsFound += 1;
    receiptDiagnostic.receiptStatus = receipt.status;
    receiptDiagnostic.confirmations = latestBlock === null
      ? null
      : latestBlock - receipt.blockNumber + 1;
    let decodedCount = 0;
    for (const entry of receipt.logs) {
      try {
        const event = iface.parseLog(entry);
        if (!event || event.name !== "UserRegistered") continue;
        decodedCount += 1;
        const confirmations = latestBlock === null ? 0 : latestBlock - receipt.blockNumber + 1;
        const decodedEvent: Record<string, unknown> = {
          transactionHash: candidate.transactionHash,
          transactionSender: transaction ? normalizeWallet(transaction.from) : null,
          destinationContract: transaction?.to ? normalizeWallet(transaction.to) : null,
          registeredUser: normalizeWallet(String(event.args.user)),
          sponsor: normalizeWallet(String(event.args.sponsor)),
          matrixParent: normalizeWallet(String(event.args.matrixParent)),
          matrixIndex: String(event.args.matrixIndex),
          matrixPosition: Number(event.args.matrixPosition),
          directSponsorIncome: String(event.args.directSponsorIncome),
          magicWalletCredit: String(event.args.magicWalletCredit),
          logIndex: entry.index,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          contractAddress: normalizeWallet(entry.address),
          receiptStatus: receipt.status,
          confirmations,
          confirmed: receipt.status === 1 && confirmations >= requiredConfirmations,
          sources: candidate.sources,
        };
        const rejectionReasons: string[] = [];
        if (decodedEvent.transactionSender !== referral) rejectionReasons.push("sender mismatch");
        if (decodedEvent.registeredUser !== referral) rejectionReasons.push("event.user mismatch");
        if (decodedEvent.sponsor !== sponsor) rejectionReasons.push("event.sponsor mismatch");
        if (decodedEvent.contractAddress !== configuredContract) rejectionReasons.push("contract mismatch");
        if (receipt.status !== 1) rejectionReasons.push("receipt failed");
        if (decodedEvent.confirmed !== true) rejectionReasons.push("not confirmed");
        decodedEvent.rejectionReasons = rejectionReasons;
        decodedUserRegisteredEvents.push(decodedEvent);
      } catch {
        // Other contract logs in the same receipt are expected not to match this ABI event.
      }
    }
    receiptDiagnostic.decodedUserRegisteredEventCount = decodedCount;
    if (!decodedCount) {
      receiptDiagnostic.rejectionReasons = [
        ...(receipt.status !== 1 ? ["receipt failed"] : []),
        "decode failed",
        ...(latestBlock === null
          || latestBlock - receipt.blockNumber + 1 < requiredConfirmations ? ["not confirmed"] : []),
      ];
      lookupFailures.push({
        transactionHash: candidate.transactionHash, lookup: "ABI decode",
        reason: "Receipt contains no UserRegistered log decodable by the configured ABI",
      });
    }
  }
  const confirmedMatchingEvents = decodedUserRegisteredEvents.filter((value) =>
    value.confirmed === true
    && value.contractAddress === configuredContract
    && value.registeredUser === referral
    && value.sponsor === sponsor
    && value.transactionSender === referral);
  if (confirmedMatchingEvents.length > 1) mismatches.push("AMBIGUOUS_REGISTRATION_EVENTS");
  let onchain: Record<string, unknown> | null = null;
  if (confirmedMatchingEvents.length === 1) {
    onchain = {
      ...confirmedMatchingEvents[0],
      eventName: "UserRegistered",
      indexedParameters: ["user", "sponsor", "matrixParent"],
      parameterOrder: [
        "user", "sponsor", "matrixParent", "matrixIndex", "matrixPosition",
        "directSponsorIncome", "magicWalletCredit",
      ],
    };
  } else {
    mismatches.push("REGISTRATION_EVENT_NOT_FOUND");
  }

  return {
    mode: "READ_ONLY",
    wallets: { sponsor, referral },
    users: users.rows,
    duplicateWalletRows: duplicates.rows,
    referralRelations: relations.rows,
    registrations: registrations.rows,
    matrixPlacements: matrixPlacements.rows,
    packagePurchases: packagePurchases.rows,
    activityHistory: activities.rows,
    blockchainTransactions: blockchainTransactions.rows,
    processedBlockchainEvents: processedEvents.rows,
    candidateTransactionHashes,
    decodedUserRegisteredEvents,
    eventDiscovery: {
      requiredConfirmedEvents: 1,
      confirmedMatchingEventCount: confirmedMatchingEvents.length,
      candidateTransactionHashes,
      candidateReceipts,
      decodedUserRegisteredEvents,
      matchingConfirmedEvents: confirmedMatchingEvents,
      lookups: {
        blockchain_transactions: {
          found: blockchainTransactions.rows.length,
          failed: blockchainTransactions.rows.length === 0,
        },
        "processed blockchain events": {
          found: processedEvents.rows.length,
          failed: processedEvents.rows.length === 0,
        },
        "decoded receipt": {
          found: receiptsFound,
          failed: receiptsFound === 0,
        },
        "registration tx hash": {
          found: candidateTransactionHashes.filter((candidate) =>
            candidate.sources.includes("registration tx hash")).length,
          failed: !candidateTransactionHashes.some((candidate) =>
            candidate.sources.includes("registration tx hash")),
        },
        "transaction receipt": {
          found: receiptsFound,
          failed: receiptsFound !== candidateTransactionHashes.length,
        },
        "ABI decode": {
          found: decodedUserRegisteredEvents.length,
          failed: decodedUserRegisteredEvents.length === 0,
        },
      },
      lookupFailures,
      conclusion: confirmedMatchingEvents.length === 1
        ? "Exactly one confirmed UserRegistered event matched"
        : `Expected exactly one confirmed UserRegistered event; found ${confirmedMatchingEvents.length}`,
    },
    balancesByUser: financialTotals.rows,
    recomputedTeamByUser: teamTotals.rows,
    ledgerRows: ledgerRows.rows,
    x3HoldOwnershipProof: x3Ownership.rows,
    registrationEvent: onchain,
    mismatches: [...new Set(mismatches)],
  };
}
