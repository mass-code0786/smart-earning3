import { Contract, Interface, Wallet } from "ethers";
import type { PoolClient } from "pg";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { getProvider } from "@/lib/blockchain/provider";
import { getServerConfig } from "./config";
import { normalizeWallet } from "./auth";
import { ApiError } from "./http";
import { keeperLockName, sponsorLockName, withPgAdvisoryLock } from "./distributed-lock";

const iface = new Interface(SMART_EARNING_ABI);
const ADVANCE_STEPS = 256n;
const CONFIRMATION_TIMEOUT_MS = 20_000;
export const MAX_PLACEMENT_ADVANCE_RETRIES = 8;

type PlacementDriver = {
  isRegistered(wallet: string): Promise<boolean>;
  simulateRegistration(wallet: string, sponsor: string): Promise<void>;
  advance(sponsor: string, steps: bigint): Promise<string>;
};

type Attempt = {
  id: string; status: string; transaction_hash: string | null;
  transaction_nonce: string | null; submitted_block: string | null;
};

function placementError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (typeof current === "object") {
      const value = current as { data?: unknown; error?: unknown; info?: unknown };
      if (typeof value.data === "string") {
        try { return iface.parseError(value.data)?.name === "PlacementSearchNeedsAdvance"; }
        catch { /* inspect nested RPC error */ }
      }
      current = value.error ?? value.info;
    } else break;
  }
  return false;
}

// Injection keeps blockchain orchestration unit-testable. Production always takes
// the PostgreSQL path below; it never relies on an in-process mutex.
export async function ensureRegistrationPlacement(
  walletInput: string,
  sponsorInput: string,
  requestKeyOrDriver: string | PlacementDriver,
) {
  const wallet = normalizeWallet(walletInput);
  const sponsor = normalizeWallet(sponsorInput);
  if (wallet === sponsor) throw new ApiError(422, "Self-referral is not allowed", "SELF_REFERRAL");
  if (typeof requestKeyOrDriver !== "string") {
    return runInjectedPlacement(wallet, sponsor, requestKeyOrDriver);
  }
  const requestKey = requestKeyOrDriver;
  const config = getServerConfig();
  const contractAddress = normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS);
  return withPgAdvisoryLock(
    sponsorLockName(97, contractAddress, sponsor),
    (client) => prepareUnderSponsorLock(client, wallet, sponsor, requestKey),
  );
}

async function prepareUnderSponsorLock(
  client: PoolClient, wallet: string, sponsor: string, requestKey: string,
) {
  const config = getServerConfig();
  const provider = getProvider();
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 97) {
    throw new ApiError(503, "Keeper RPC is not connected to BNB Testnet", "WRONG_RPC_NETWORK");
  }
  const contractAddress = normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS);
  const contract = new Contract(contractAddress, SMART_EARNING_ABI, provider);
  if (await contract.registered(wallet)) throw new ApiError(409, "Wallet is already registered", "ALREADY_REGISTERED");
  if (!(await contract.registered(sponsor))) throw new ApiError(422, "Sponsor is not registered", "SPONSOR_NOT_REGISTERED");

  const preparation = await client.query<{ id: string; requested_by_user_wallet: string; sponsor_wallet: string }>(
    `INSERT INTO placement_preparation_requests(
       chain_id,registration_contract,sponsor_wallet,requested_by_user_wallet,request_key,status
     ) VALUES(97,$1,$2,$3,$4,'PREPARING')
     ON CONFLICT(request_key) DO UPDATE SET updated_at=now()
     RETURNING id,requested_by_user_wallet,sponsor_wallet`,
    [contractAddress, sponsor, wallet, requestKey],
  );
  const prep = preparation.rows[0];
  if (prep.requested_by_user_wallet !== wallet || prep.sponsor_wallet !== sponsor) {
    throw new ApiError(409, "Request key belongs to another preparation", "REQUEST_KEY_CONFLICT");
  }

  const hashes: string[] = [];
  for (let sequence = 0; sequence <= MAX_PLACEMENT_ADVANCE_RETRIES; sequence++) {
    const active = await client.query<Attempt>(
      `SELECT id,status,transaction_hash,transaction_nonce,submitted_block
       FROM placement_advancement_attempts
       WHERE chain_id=97 AND registration_contract=$1 AND sponsor_wallet=$2
         AND status IN ('PREPARING','SUBMITTING','SUBMITTED','TIMED_OUT')
       ORDER BY created_at DESC LIMIT 1`,
      [contractAddress, sponsor],
    );
    if (active.rows[0]) {
      const hash = await reconcileOrSubmit(client, active.rows[0], prep.id, wallet, sponsor);
      if (hash) hashes.push(hash);
    }

    try {
      const data = iface.encodeFunctionData("register", [sponsor]);
      await provider.call({ to: contractAddress, from: wallet, data });
      await client.query(
        "UPDATE placement_preparation_requests SET status=$2,updated_at=now() WHERE id=$1",
        [prep.id, hashes.length ? "CONFIRMED" : "NOT_REQUIRED"],
      );
      return { ready: true, status: "READY_TO_REGISTER", advancementTransactions: hashes };
    } catch (error) {
      if (!placementError(error)) throw error;
      if (sequence === MAX_PLACEMENT_ADVANCE_RETRIES) {
        await client.query(
          `UPDATE placement_preparation_requests SET status='FAILED',
             error_code='PLACEMENT_RETRY_LIMIT',error_message=$2,updated_at=now() WHERE id=$1`,
          [prep.id, "Placement search retry limit reached"],
        );
        throw new ApiError(503, "Placement search retry limit reached", "PLACEMENT_RETRY_LIMIT");
      }
      const [head] = await contract.getPlacementQueueState(sponsor);
      const attempt = await client.query<Attempt>(
        `INSERT INTO placement_advancement_attempts(
           preparation_id,chain_id,registration_contract,sponsor_wallet,keeper_wallet,
           requested_by_user_wallet,request_key,starting_queue_head,status
         ) VALUES($1,97,$2,$3,$4,$5,$6,$7,'PREPARING')
         ON CONFLICT(request_key) DO UPDATE SET updated_at=now()
         RETURNING id,status,transaction_hash,transaction_nonce,submitted_block`,
        [prep.id, contractAddress, sponsor, keeperAddress(), wallet, `${requestKey}:${sequence}`, head.toString()],
      );
      const hash = await reconcileOrSubmit(client, attempt.rows[0], prep.id, wallet, sponsor);
      if (hash) hashes.push(hash);
    }
  }
  throw new ApiError(503, "Placement preparation failed", "PLACEMENT_NOT_READY");
}

async function reconcileOrSubmit(
  client: PoolClient, attempt: Attempt, preparationId: string, wallet: string, sponsor: string,
) {
  const config = getServerConfig();
  const provider = getProvider();
  if (attempt.transaction_hash) {
    const receipt = await provider.waitForTransaction(
      attempt.transaction_hash, config.CONFIRMATIONS_REQUIRED, CONFIRMATION_TIMEOUT_MS,
    );
    if (!receipt) {
      const replacement = attempt.transaction_nonce === null ? null : await findKeeperTransaction(
        Number(attempt.transaction_nonce),
        Number(attempt.submitted_block ?? 0),
      );
      if (replacement && replacement.toLowerCase() !== attempt.transaction_hash.toLowerCase()) {
        await client.query(
          `UPDATE placement_advancement_attempts SET status='REPLACED',transaction_hash=$2,
             updated_at=now() WHERE id=$1`,
          [attempt.id, replacement.toLowerCase()],
        );
        return reconcileOrSubmit(
          client,
          { ...attempt, status: "REPLACED", transaction_hash: replacement },
          preparationId, wallet, sponsor,
        );
      }
      await client.query(
        "UPDATE placement_advancement_attempts SET status='TIMED_OUT',updated_at=now() WHERE id=$1",
        [attempt.id],
      );
      throw new ApiError(409, "Placement transaction is still pending", "PLACEMENT_TX_PENDING");
    }
    if (receipt.status !== 1) {
      await client.query(
        `UPDATE placement_advancement_attempts SET status='FAILED',
           error_code='TX_REVERTED',error_message='Keeper transaction reverted',updated_at=now() WHERE id=$1`,
        [attempt.id],
      );
      throw new ApiError(503, "Placement advancement reverted", "PLACEMENT_TX_REVERTED");
    }
    const contract = new Contract(config.SMART_EARNING_CONTRACT_ADDRESS, SMART_EARNING_ABI, provider);
    const [endingHead] = await contract.getPlacementQueueState(sponsor);
    await client.query(
      `UPDATE placement_advancement_attempts SET status='CONFIRMED',ending_queue_head=$2,
         confirmed_at=now(),updated_at=now() WHERE id=$1`,
      [attempt.id, endingHead.toString()],
    );
    return attempt.transaction_hash;
  }

  if (attempt.status === "SUBMITTING" && attempt.transaction_nonce !== null) {
    const pending = await provider.getTransactionCount(keeperAddress(), "pending");
    if (pending > Number(attempt.transaction_nonce)) {
      const recovered = await findKeeperTransaction(
        Number(attempt.transaction_nonce),
        Number(attempt.submitted_block ?? 0),
      );
      if (recovered) {
        await client.query(
          `UPDATE placement_advancement_attempts SET status='SUBMITTED',transaction_hash=$2,
             submitted_at=COALESCE(submitted_at,now()),updated_at=now() WHERE id=$1`,
          [attempt.id, recovered.toLowerCase()],
        );
        return reconcileOrSubmit(
          client,
          { ...attempt, status: "SUBMITTED", transaction_hash: recovered },
          preparationId, wallet, sponsor,
        );
      }
      throw new ApiError(
        409,
        "A keeper transaction was submitted and is being reconciled",
        "KEEPER_SUBMISSION_RECONCILING",
      );
    }
  }

  const submittedHash = await withPgAdvisoryLock(keeperLockName(97, keeperAddress()), async (nonceClient) => {
    const nonce = attempt.transaction_nonce === null
      ? await provider.getTransactionCount(keeperAddress(), "pending")
      : Number(attempt.transaction_nonce);
    await nonceClient.query(
      `UPDATE placement_advancement_attempts SET status='SUBMITTING',
         transaction_nonce=$2,submitted_block=$3,updated_at=now() WHERE id=$1`,
      [attempt.id, nonce, await provider.getBlockNumber()],
    );
    const signer = new Wallet(config.KEEPER_PRIVATE_KEY!, provider);
    const contract = new Contract(config.SMART_EARNING_CONTRACT_ADDRESS, SMART_EARNING_ABI, signer);
    let sent;
    try {
      sent = await contract.advancePlacementCursor(sponsor, ADVANCE_STEPS, { nonce });
    } catch (error) {
      await nonceClient.query(
        `UPDATE placement_advancement_attempts SET status='FAILED',error_code='SUBMISSION_FAILED',
           error_message=$2,updated_at=now() WHERE id=$1`,
        [attempt.id, error instanceof Error ? error.message.slice(0, 1000) : "Unknown submission error"],
      );
      throw error;
    }
    // Once broadcast returns, never classify later persistence errors as safe
    // failures. The durable SUBMITTING nonce is the crash-recovery anchor.
    await nonceClient.query(
      `UPDATE placement_advancement_attempts SET status='SUBMITTED',transaction_hash=$2,
         submitted_at=now(),updated_at=now() WHERE id=$1`,
      [attempt.id, sent.hash.toLowerCase()],
    );
    await nonceClient.query(
      "UPDATE placement_preparation_requests SET status='SUBMITTED',updated_at=now() WHERE id=$1",
      [preparationId],
    );
    return sent.hash;
  });
  // The global keeper nonce lock is released before confirmation waiting.
  return reconcileOrSubmit(
    client,
    { ...attempt, status: "SUBMITTED", transaction_hash: submittedHash },
    preparationId,
    wallet,
    sponsor,
  );
}

async function findKeeperTransaction(nonce: number, submittedBlock: number) {
  const provider = getProvider();
  const config = getServerConfig();
  const latest = await provider.getBlockNumber();
  const first = Math.max(submittedBlock, latest - 256, 0);
  const keeper = keeperAddress();
  const selector = iface.getFunction("advancePlacementCursor")!.selector.toLowerCase();
  for (let number = latest; number >= first; number--) {
    const block = await provider.getBlock(number, true);
    if (!block) continue;
    for (const transaction of block.prefetchedTransactions) {
      if (
        transaction.from.toLowerCase() === keeper &&
        transaction.nonce === nonce &&
        transaction.to?.toLowerCase() === config.SMART_EARNING_CONTRACT_ADDRESS.toLowerCase() &&
        transaction.data.toLowerCase().startsWith(selector)
      ) {
        return transaction.hash;
      }
    }
  }
  return null;
}

function keeperAddress() {
  const key = getServerConfig().KEEPER_PRIVATE_KEY;
  if (!key) throw new ApiError(503, "Placement keeper is not configured", "KEEPER_NOT_CONFIGURED");
  return new Wallet(key).address.toLowerCase();
}

async function runInjectedPlacement(wallet: string, sponsor: string, driver: PlacementDriver) {
  if (await driver.isRegistered(wallet)) throw new ApiError(409, "Wallet is already registered", "ALREADY_REGISTERED");
  if (!(await driver.isRegistered(sponsor))) throw new ApiError(422, "Sponsor is not registered", "SPONSOR_NOT_REGISTERED");
  const advancementTransactions: string[] = [];
  for (let attempt = 0; attempt <= MAX_PLACEMENT_ADVANCE_RETRIES; attempt++) {
    try {
      await driver.simulateRegistration(wallet, sponsor);
      return { ready: true, status: "READY_TO_REGISTER", advancementTransactions };
    } catch (error) {
      if (!placementError(error)) throw error;
      if (attempt === MAX_PLACEMENT_ADVANCE_RETRIES) {
        throw new ApiError(503, "Placement search retry limit reached", "PLACEMENT_RETRY_LIMIT");
      }
      advancementTransactions.push(await driver.advance(sponsor, ADVANCE_STEPS));
    }
  }
  throw new ApiError(503, "Placement preparation failed", "PLACEMENT_NOT_READY");
}
