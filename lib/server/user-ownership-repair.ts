import { normalizeWallet } from "./auth";
import { transaction } from "./db";
import { diagnoseUserOwnership } from "./user-ownership-diagnostic";
import { CHAIN_ID } from "./config";

type Diagnostic = Awaited<ReturnType<typeof diagnoseUserOwnership>>;

const ALLOWED_SPONSOR = "0xeb6cb3735b4def00acbff615b7337f09c4bab37c";
const ALLOWED_REFERRAL = "0xfd314f3a6e47a802a73da6d620ab3114f14d042f";

export function assertOwnershipRepairAllowlist(sponsorInput: string, referralInput: string) {
  const sponsor = normalizeWallet(sponsorInput);
  const referral = normalizeWallet(referralInput);
  if (sponsor !== ALLOWED_SPONSOR || referral !== ALLOWED_REFERRAL) {
    throw new Error("Repair is restricted to the exact production sponsor/referral allowlist");
  }
  return { sponsor, referral };
}

function requireEvidence(diagnostic: Diagnostic) {
  if (diagnostic.duplicateWalletRows.length || diagnostic.users.length !== 2) {
    throw new Error("Wallet/user mapping is ambiguous");
  }
  const event = diagnostic.registrationEvent as {
    transactionHash: string; transactionSender: string; registeredUser: string;
    sponsor: string; matrixParent: string; matrixIndex: string; matrixPosition: number;
    directSponsorIncome: string; magicWalletCredit: string; logIndex: number;
    blockNumber: number; blockHash: string; contractAddress: string;
  } | null;
  if (!event) throw new Error("A single confirmed UserRegistered event is required");
  if (diagnostic.mismatches.includes("AMBIGUOUS_REGISTRATION_EVENTS")) {
    throw new Error("More than one confirmed registration event matched the referral");
  }
  if (event.registeredUser !== diagnostic.wallets.referral
      || event.transactionSender !== diagnostic.wallets.referral
      || event.sponsor !== diagnostic.wallets.sponsor) {
    throw new Error("Decoded registration event does not match the two-wallet allowlist");
  }
  const sponsorUser = diagnostic.users.find(
    (row) => row.wallet_address.toLowerCase() === diagnostic.wallets.sponsor,
  );
  const referralUser = diagnostic.users.find(
    (row) => row.wallet_address.toLowerCase() === diagnostic.wallets.referral,
  );
  if (!sponsorUser || !referralUser) throw new Error("Both allowlisted users must resolve uniquely");
  return { event, sponsorUser, referralUser };
}

export function ownershipRepairPlan(diagnostic: Diagnostic) {
  const { event, sponsorUser, referralUser } = requireEvidence(diagnostic);
  const registrations = diagnostic.registrations as Array<Record<string, unknown>>;
  const matchingRegistrations = registrations.filter(
    (row) => String(row.tx_hash || "").toLowerCase() === event.transactionHash.toLowerCase(),
  );
  if (matchingRegistrations.length > 1) throw new Error("Registration mapping is ambiguous");
  const registration = matchingRegistrations[0] || null;
  const relations = diagnostic.referralRelations as Array<Record<string, unknown>>;
  const matchingRelations = relations.filter(
    (row) => row.user_id === referralUser.id || row.registration_id === registration?.id,
  );
  if (matchingRelations.length > 1) throw new Error("Referral mapping is ambiguous");
  const relation = matchingRelations[0] || null;
  const placements = diagnostic.matrixPlacements as Array<Record<string, unknown>>;
  const matchingPlacements = placements.filter(
    (row) => row.user_id === referralUser.id || row.registration_id === registration?.id,
  );
  if (matchingPlacements.length > 1) throw new Error("Matrix placement mapping is ambiguous");
  const placement = matchingPlacements[0] || null;
  const ledgerRows = diagnostic.ledgerRows as Array<Record<string, unknown>>;
  const directPrefix = `registration:${event.transactionHash.toLowerCase()}:direct`;
  const registrationMagicKey = `registration:${event.transactionHash.toLowerCase()}:magic`;
  const proposedChanges: Array<Record<string, unknown>> = [];

  if (!registration
      || registration.user_id !== referralUser.id
      || registration.sponsor_user_id !== sponsorUser.id) {
    proposedChanges.push({
      table: "registrations", rowId: registration?.id || null,
      reason: "UserRegistered proves registered user and sponsor ownership",
      expected: { user_id: referralUser.id, sponsor_user_id: sponsorUser.id },
    });
  }
  if (!relation
      || relation.user_id !== referralUser.id
      || relation.sponsor_user_id !== sponsorUser.id) {
    proposedChanges.push({
      table: "referral_relations", rowId: relation?.id || null,
      reason: "Referral relation must follow the decoded UserRegistered event",
      expected: { user_id: referralUser.id, sponsor_user_id: sponsorUser.id },
    });
  }
  if (!placement || placement.user_id !== referralUser.id
      || String(placement.parent_wallet || "").toLowerCase() !== event.matrixParent) {
    proposedChanges.push({
      table: "matrix_placements", rowId: placement?.id || null,
      reason: "Matrix user and parent must follow the decoded UserRegistered event",
      expected: { user_id: referralUser.id, parent_wallet: event.matrixParent },
    });
  }
  const blockchainLink = (diagnostic.blockchainTransactions as Array<Record<string, unknown>>)
    .find((row) =>
      String(row.tx_hash || "").toLowerCase() === event.transactionHash.toLowerCase()
      && Number(row.log_index) === event.logIndex);
  if (!blockchainLink
      || String(blockchainLink.from_address || "").toLowerCase() !== diagnostic.wallets.referral
      || String((blockchainLink.raw_payload as { sponsor?: string } | null)?.sponsor || "").toLowerCase()
        !== diagnostic.wallets.sponsor) {
    proposedChanges.push({
      table: "blockchain_transactions", rowId: blockchainLink?.id || null,
      reason: "Registration transaction linkage must match the decoded event",
      expected: {
        tx_hash: event.transactionHash, log_index: event.logIndex,
        from_address: diagnostic.wallets.referral, sponsor: diagnostic.wallets.sponsor,
      },
    });
  }
  for (const row of ledgerRows) {
    const key = String(row.idempotency_key || "").toLowerCase();
    const expectedOwner = key === registrationMagicKey
      ? referralUser.id
      : key.startsWith(directPrefix) ? sponsorUser.id : null;
    if (expectedOwner && row.user_id !== expectedOwner) {
      proposedChanges.push({
        table: row.source, rowId: row.id, currentUserId: row.user_id,
        expectedUserId: expectedOwner,
        amount: row.amount,
        reason: key === registrationMagicKey
          ? "Registration Magic belongs to event.user"
          : "Registration direct earning belongs to event.sponsor",
      });
    }
  }
  for (const row of diagnostic.x3HoldOwnershipProof as Array<Record<string, unknown>>) {
    if (row.current_user_id !== row.expected_user_id
        && row.expected_user_id === row.cycle_owner_user_id) {
      proposedChanges.push({
        table: "x3_hold_ledger", rowId: row.hold_id,
        currentUserId: row.current_user_id, expectedUserId: row.expected_user_id,
        amount: row.amount, packageId: row.package_id,
        sourcePackagePurchaseId: row.source_package_purchase_id,
        matrixPlacedUserId: row.matrix_placed_user_id,
        reason: "X3 income owner and cycle owner independently prove hold ownership",
      });
    }
  }
  for (const row of diagnostic.activityHistory as Array<Record<string, unknown>>) {
    if (row.event_type === "DIRECT_REFERRAL_ACTIVATED"
        && String(row.tx_hash || "").toLowerCase() === event.transactionHash.toLowerCase()
        && (row.user_id !== sponsorUser.id || row.source_user_id !== referralUser.id)) {
      proposedChanges.push({
        table: "activity_history", rowId: row.id,
        currentUserId: row.user_id, expectedUserId: sponsorUser.id,
        reason: "Direct referral activity belongs to sponsor and references the registered user",
      });
    }
  }
  return {
    mode: "DRY_RUN",
    allowlist: diagnostic.wallets,
    sponsorUserId: sponsorUser.id,
    referralUserId: referralUser.id,
    registrationEvent: event,
    registrationBefore: registration,
    referralRelationBefore: relation,
    matrixPlacementBefore: placement,
    balancesBefore: diagnostic.balancesByUser,
    recomputedTeamBefore: diagnostic.recomputedTeamByUser,
    affectedLedgerRows: ledgerRows,
    proposedChanges,
    expectedOwnership: {
      registeredUserId: referralUser.id,
      sponsorUserId: sponsorUser.id,
      registrationMagicOwnerId: referralUser.id,
      directIncomeOwnerId: sponsorUser.id,
      x3HoldRule: "x3_hold_ledger.user_id must equal x3_income_ledger.owner_user_id and x3_cycles.user_id",
    },
  };
}

export async function repairUserOwnership(input: {
  sponsor: string;
  referral: string;
  apply?: boolean;
}) {
  const wallets = assertOwnershipRepairAllowlist(input.sponsor, input.referral);
  const diagnostic = await diagnoseUserOwnership(wallets.sponsor, wallets.referral);
  const plan = ownershipRepairPlan(diagnostic);
  if (!input.apply || plan.proposedChanges.length === 0) {
    return { ...plan, applied: false, noOp: plan.proposedChanges.length === 0 };
  }

  const event = plan.registrationEvent;
  const result = await transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`ownership-repair:${wallets.sponsor}:${wallets.referral}`],
    );
    const locked = await client.query<{ id: string; wallet_address: string }>(
      `SELECT id,wallet_address FROM users
       WHERE lower(wallet_address) IN(lower($1),lower($2))
       ORDER BY id FOR UPDATE`,
      [wallets.sponsor, wallets.referral],
    );
    if (locked.rows.length !== 2) throw new Error("User mapping drifted before repair");
    const sponsorUserId = locked.rows.find(
      (row) => row.wallet_address.toLowerCase() === wallets.sponsor,
    )?.id;
    const referralUserId = locked.rows.find(
      (row) => row.wallet_address.toLowerCase() === wallets.referral,
    )?.id;
    if (sponsorUserId !== plan.sponsorUserId || referralUserId !== plan.referralUserId) {
      throw new Error("User mapping drifted before repair");
    }

    await client.query(
      `SELECT id FROM registrations
       WHERE lower(tx_hash)=lower($1) OR user_id=ANY($2::uuid[]) FOR UPDATE`,
      [event.transactionHash, [sponsorUserId, referralUserId]],
    );
    await client.query(
      `SELECT id FROM referral_relations
       WHERE user_id=ANY($1::uuid[]) OR sponsor_user_id=ANY($1::uuid[]) FOR UPDATE`,
      [[sponsorUserId, referralUserId]],
    );

    const registration = (await client.query<{ id: string }>(
      `INSERT INTO registrations(
         user_id,sponsor_user_id,tx_hash,chain_id,amount_token_units,status,block_number,confirmed_at
       ) VALUES($1,$2,$3,$4,$5,'CONFIRMED',$6,now())
       ON CONFLICT(tx_hash) DO UPDATE SET user_id=EXCLUDED.user_id,
         sponsor_user_id=EXCLUDED.sponsor_user_id,status='CONFIRMED',
         block_number=EXCLUDED.block_number,confirmed_at=COALESCE(registrations.confirmed_at,now())
       RETURNING id`,
      [
        referralUserId, sponsorUserId, event.transactionHash, CHAIN_ID,
        (BigInt(event.magicWalletCredit) * 2n).toString(), event.blockNumber,
      ],
    )).rows[0];

    const relationUpdate = await client.query(
      `UPDATE referral_relations SET user_id=$1,sponsor_user_id=$2,registration_id=$3
       WHERE registration_id=$3 OR user_id=$1`,
      [referralUserId, sponsorUserId, registration.id],
    );
    if (!relationUpdate.rowCount) {
      await client.query(
        `INSERT INTO referral_relations(user_id,sponsor_user_id,registration_id)
         VALUES($1,$2,$3)`,
        [referralUserId, sponsorUserId, registration.id],
      );
    }
    const parent = (await client.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(wallet_address)=lower($1)",
      [event.matrixParent],
    )).rows[0];
    if (!parent) throw new Error("Decoded matrix parent is not uniquely indexed");
    const placementUpdate = await client.query(
      `UPDATE matrix_placements SET user_id=$1,parent_user_id=$2,position=$3,
         contract_address=$4,contract_matrix_index=$5,registration_id=$6
       WHERE registration_id=$6 OR user_id=$1`,
      [referralUserId, parent.id, event.matrixPosition, event.contractAddress,
        event.matrixIndex, registration.id],
    );
    if (!placementUpdate.rowCount) {
      await client.query(
        `INSERT INTO matrix_placements(
           user_id,parent_user_id,position,contract_address,contract_matrix_index,registration_id
         ) VALUES($1,$2,$3,$4,$5,$6)`,
        [referralUserId, parent.id, event.matrixPosition, event.contractAddress,
          event.matrixIndex, registration.id],
      );
    }
    await client.query(
      `INSERT INTO blockchain_transactions(
         chain_id,tx_hash,block_number,block_hash,from_address,to_address,event_name,
         log_index,status,confirmations,raw_payload,confirmed_at
       ) VALUES($1,$2,$3,$4,$5,$6,'UserRegistered',$7,'CONFIRMED',3,$8,now())
       ON CONFLICT(chain_id,tx_hash,log_index) DO UPDATE SET
         from_address=EXCLUDED.from_address,to_address=EXCLUDED.to_address,
         event_name='UserRegistered',status='CONFIRMED',raw_payload=EXCLUDED.raw_payload`,
      [
        CHAIN_ID,event.transactionHash, event.blockNumber, event.blockHash, wallets.referral,
        event.contractAddress, event.logIndex,
        JSON.stringify({ sponsor: wallets.sponsor, matrixParent: event.matrixParent }),
      ],
    );

    // These append-only rows are not recreated. Trigger bypass is transaction-local
    // and ownership-only; amounts, transaction hashes, and idempotency keys remain unchanged.
    const appendOnlyTables = [
      "magic_wallet_ledger", "income_credit_ledger", "earning_split_events",
      "income_wallet_ledger", "magic_funding_events", "direct_income_ledger",
      "x3_hold_ledger", "activity_history",
    ];
    for (const table of appendOnlyTables) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    }
    const tx = event.transactionHash.toLowerCase();
    await client.query(
      `UPDATE magic_wallet_ledger SET user_id=$1
       WHERE lower(idempotency_key)=lower($2) AND user_id<>$1`,
      [referralUserId, `registration:${tx}:magic`],
    );
    await client.query(
      `UPDATE income_credit_ledger SET user_id=$1
       WHERE lower(idempotency_key)=lower($2) AND user_id<>$1`,
      [sponsorUserId, `registration:${tx}:direct-cap:cap`],
    );
    await client.query(
      `UPDATE earning_split_events SET user_id=$1
       WHERE lower(idempotency_key)=lower($2) AND user_id<>$1`,
      [sponsorUserId, `registration:${tx}:direct-cap`],
    );
    await client.query(
      `UPDATE income_wallet_ledger SET user_id=$1
       WHERE lower(idempotency_key)=lower($2) AND user_id<>$1`,
      [sponsorUserId, `registration:${tx}:direct-cap:income`],
    );
    await client.query(
      `UPDATE magic_funding_events SET user_id=$1
       WHERE lower(idempotency_key)=lower($2) AND user_id<>$1`,
      [sponsorUserId, `registration:${tx}:direct-cap:magic`],
    );
    await client.query(
      `UPDATE magic_wallet_ledger SET user_id=$1
       WHERE lower(idempotency_key)=lower($2) AND user_id<>$1`,
      [sponsorUserId, `registration:${tx}:direct-cap:magic-ledger`],
    );
    await client.query(
      `UPDATE direct_income_ledger SET sponsor_user_id=$1,source_user_id=$2,registration_id=$3
       WHERE lower(idempotency_key)=lower($4)`,
      [sponsorUserId, referralUserId, registration.id, `registration:${tx}:direct`],
    );
    await client.query(
      `UPDATE x3_hold_ledger h SET user_id=i.owner_user_id
       FROM x3_income_ledger i JOIN x3_cycles c ON c.id=i.owner_cycle_id
       WHERE h.x3_income_ledger_id=i.id AND i.owner_user_id=c.user_id
         AND h.user_id<>i.owner_user_id
         AND h.user_id=ANY($1::uuid[]) AND i.owner_user_id=ANY($1::uuid[])`,
      [[sponsorUserId, referralUserId]],
    );
    await client.query(
      `UPDATE activity_history a SET user_id=u.id,user_wallet=u.wallet_address
       FROM users u WHERE a.source_table IN(
         'income_wallet_ledger','magic_wallet_ledger','x3_hold_ledger','earning_split_events'
       ) AND a.source_record_id IS NOT NULL
       AND u.id=CASE a.source_table
         WHEN 'income_wallet_ledger' THEN (SELECT l.user_id FROM income_wallet_ledger l WHERE l.id::text=a.source_record_id)
         WHEN 'magic_wallet_ledger' THEN (SELECT l.user_id FROM magic_wallet_ledger l WHERE l.id::text=a.source_record_id)
         WHEN 'x3_hold_ledger' THEN (SELECT l.user_id FROM x3_hold_ledger l WHERE l.id::text=a.source_record_id)
         WHEN 'earning_split_events' THEN (SELECT l.user_id FROM earning_split_events l WHERE l.id::text=a.source_record_id)
       END AND a.user_id=ANY($1::uuid[])`,
      [[sponsorUserId, referralUserId]],
    );
    await client.query(
      `UPDATE activity_history SET user_id=$1,user_wallet=$2,source_user_id=$3,
         source_wallet=$4,sponsor_wallet=$2
       WHERE event_type='DIRECT_REFERRAL_ACTIVATED' AND lower(tx_hash)=lower($5)
         AND(user_id<>$1 OR source_user_id IS DISTINCT FROM $3)`,
      [sponsorUserId, wallets.sponsor, referralUserId, wallets.referral, event.transactionHash],
    );
    for (const table of [...appendOnlyTables].reverse()) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }

    await client.query(
      `UPDATE users u SET direct_count=(
         SELECT count(*)::int FROM referral_relations rr WHERE rr.sponsor_user_id=u.id
       ) WHERE u.id=ANY($1::uuid[])`,
      [[sponsorUserId, referralUserId]],
    );
    for (const userId of [sponsorUserId, referralUserId]) {
      await client.query(
        `UPDATE user_package_states ups SET
           total_earned=owned.total_earned,
           remaining_cap=GREATEST(ups.total_earning_cap-owned.total_earned,0),
           capping_status=CASE
             WHEN ups.total_package_value=0 THEN 'NOT_APPLICABLE'
             WHEN owned.total_earned>=ups.total_earning_cap THEN 'CAPPED'
             WHEN owned.total_earned*100>=ups.total_earning_cap*90 THEN 'NEAR_CAP'
             ELSE 'ACTIVE' END,
           updated_at=now()
         FROM(SELECT COALESCE(sum(credited_amount),0) total_earned
              FROM income_credit_ledger WHERE user_id=$1)owned
         WHERE ups.user_id=$1`,
        [userId],
      );
    }
    const verification = (await client.query<{
      registration_ok: boolean; relation_ok: boolean; placement_ok: boolean;
      x3_mismatches: number; sponsor_direct_count: number; actual_direct_count: number;
    }>(
      `SELECT
       EXISTS(SELECT 1 FROM registrations WHERE id=$1 AND user_id=$2 AND sponsor_user_id=$3)
         registration_ok,
       EXISTS(SELECT 1 FROM referral_relations WHERE registration_id=$1 AND user_id=$2 AND sponsor_user_id=$3)
         relation_ok,
       EXISTS(SELECT 1 FROM matrix_placements WHERE registration_id=$1 AND user_id=$2 AND parent_user_id=$4)
         placement_ok,
       (SELECT count(*)::int FROM x3_hold_ledger h JOIN x3_income_ledger i
          ON i.id=h.x3_income_ledger_id JOIN x3_cycles c ON c.id=i.owner_cycle_id
        WHERE h.user_id<>i.owner_user_id AND i.owner_user_id=c.user_id
          AND(h.user_id=ANY($5::uuid[]) OR i.owner_user_id=ANY($5::uuid[]))) x3_mismatches,
       (SELECT direct_count FROM users WHERE id=$3) sponsor_direct_count,
       (SELECT count(*)::int FROM referral_relations WHERE sponsor_user_id=$3) actual_direct_count`,
      [registration.id, referralUserId, sponsorUserId, parent.id, [sponsorUserId, referralUserId]],
    )).rows[0];
    if (!verification.registration_ok || !verification.relation_ok || !verification.placement_ok
        || verification.x3_mismatches !== 0
        || verification.sponsor_direct_count !== verification.actual_direct_count) {
      throw new Error("Post-repair ownership verification failed; transaction rolled back");
    }
    return { registrationId: registration.id };
  });

  const after = await diagnoseUserOwnership(wallets.sponsor, wallets.referral);
  const afterPlan = ownershipRepairPlan(after);
  return { ...afterPlan, applied: true, noOp: false, result, balancesAfter: after.balancesByUser };
}
