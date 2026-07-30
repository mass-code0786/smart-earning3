import { Interface } from "ethers";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { getProvider } from "@/lib/blockchain/provider";
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
          OR lower(raw_payload->>'sponsor') IN(lower($1),lower($2))
       ORDER BY created_at,id`,
      [sponsor, referral],
    ),
    query(
      `SELECT pe.* FROM blockchain_processed_events pe
       JOIN blockchain_transactions bt
         ON bt.chain_id=pe.chain_id AND lower(bt.tx_hash)=lower(pe.transaction_hash)
        AND bt.log_index=pe.log_index
       WHERE lower(bt.from_address) IN(lower($1),lower($2))
          OR lower(bt.raw_payload->>'sponsor') IN(lower($1),lower($2))
       ORDER BY pe.block_number,pe.log_index`,
      [sponsor, referral],
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
  const candidateTransactions = (blockchainTransactions.rows as Array<{
    tx_hash?: string; event_name?: string; status?: string; from_address?: string;
  }>).filter((row) =>
    row.event_name === "UserRegistered"
    && row.status === "CONFIRMED"
    && row.from_address?.toLowerCase() === referral);
  if (candidateTransactions.length > 1) mismatches.push("AMBIGUOUS_REGISTRATION_EVENTS");
  const registrationTxHash = referralUser?.registration_tx_hash
    || (candidateTransactions.length === 1 ? candidateTransactions[0].tx_hash || null : null);
  let onchain: Record<string, unknown> | null = null;
  if (registrationTxHash) {
    const provider = getProvider();
    const [transaction, receipt] = await Promise.all([
      provider.getTransaction(registrationTxHash),
      provider.getTransactionReceipt(registrationTxHash),
    ]);
    const decoded = receipt?.logs.map((entry) => {
      try {
        const event = iface.parseLog(entry);
        return event?.name === "UserRegistered" ? { entry, event } : null;
      } catch {
        return null;
      }
    }).find(Boolean);
    if (!transaction || !receipt || !decoded?.event) {
      mismatches.push("REGISTRATION_EVENT_NOT_FOUND");
    } else {
      const registeredUser = normalizeWallet(String(decoded.event.args.user));
      const eventSponsor = normalizeWallet(String(decoded.event.args.sponsor));
      onchain = {
        transactionHash: registrationTxHash,
        transactionSender: normalizeWallet(transaction.from),
        eventName: decoded.event.name,
        indexedParameters: ["user", "sponsor", "matrixParent"],
        parameterOrder: [
          "user", "sponsor", "matrixParent", "matrixIndex", "matrixPosition",
          "directSponsorIncome", "magicWalletCredit",
        ],
        registeredUser,
        sponsor: eventSponsor,
        matrixParent: normalizeWallet(String(decoded.event.args.matrixParent)),
        matrixIndex: String(decoded.event.args.matrixIndex),
        matrixPosition: Number(decoded.event.args.matrixPosition),
        directSponsorIncome: String(decoded.event.args.directSponsorIncome),
        magicWalletCredit: String(decoded.event.args.magicWalletCredit),
        logIndex: decoded.entry.index,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        contractAddress: normalizeWallet(transaction.to || ""),
      };
      if (registeredUser !== referral) mismatches.push("EVENT_REGISTERED_USER_MISMATCH");
      if (eventSponsor !== sponsor) mismatches.push("EVENT_SPONSOR_MISMATCH");
      if (normalizeWallet(transaction.from) !== referral) mismatches.push("TRANSACTION_SENDER_MISMATCH");
    }
  } else {
    mismatches.push("REFERRAL_REGISTRATION_NOT_FOUND");
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
    balancesByUser: financialTotals.rows,
    recomputedTeamByUser: teamTotals.rows,
    ledgerRows: ledgerRows.rows,
    x3HoldOwnershipProof: x3Ownership.rows,
    registrationEvent: onchain,
    mismatches: [...new Set(mismatches)],
  };
}
