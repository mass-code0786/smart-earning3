const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartEarning security hardening", function () {
  const DOLLAR = 1_000_000n;
  const TYPES = {
    WithdrawalAuthorization: [
      { name: "payoutType", type: "bytes32" },
      { name: "reservationId", type: "bytes32" },
      { name: "earningSource", type: "bytes32" },
      { name: "user", type: "address" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "grossAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "netAmount", type: "uint256" },
      { name: "destination", type: "address" },
      { name: "issuedAt", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  let token, contract, admin, genesis, treasury, authorizer, executor, user, other;

  beforeEach(async function () {
    [admin, genesis, treasury, authorizer, executor, user, other] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockUSDT")).deploy();
    contract = await (await ethers.getContractFactory("SmartEarning")).deploy(
      await token.getAddress(), genesis.address, admin.address, treasury.address, authorizer.address
    );
    await contract.grantRole(await contract.WITHDRAWAL_EXECUTOR_ROLE(), executor.address);
    await token.mint(treasury.address, 20n * DOLLAR);
    await token.connect(treasury).approve(await contract.getAddress(), 20n * DOLLAR);
    await contract.connect(treasury).fundWithdrawalLiquidity(10n * DOLLAR, ethers.id("security-liquidity"));
  });

  async function makeAuthorization(overrides = {}, signer = authorizer, target = contract) {
    const network = await ethers.provider.getNetwork();
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const verifyingContract = await target.getAddress();
    const value = {
      payoutType: ethers.id("DIVIDEND"),
      reservationId: ethers.id("reservation-1"),
      earningSource: ethers.id("daily-dividend:2026-07-26"),
      user: user.address,
      chainId: network.chainId,
      verifyingContract,
      grossAmount: DOLLAR,
      feeAmount: 100_000n,
      netAmount: 900_000n,
      destination: user.address,
      issuedAt: now,
      nonce: 1n,
      deadline: now + 3600n,
      ...overrides,
    };
    const signature = await signer.signTypedData(
      { name: "SmartEarning", version: "1", chainId: network.chainId, verifyingContract },
      TYPES,
      value
    );
    return { value, signature };
  }

  it("rejects replay and a changed reservation ID for the same logical withdrawal", async function () {
    const auth = await makeAuthorization();
    await contract.connect(executor).executeWithdrawal(auth.value, auth.signature);
    await expect(contract.connect(executor).executeWithdrawal(auth.value, auth.signature))
      .to.be.revertedWithCustomError(contract, "WithdrawalAlreadyProcessed");
    await expect(contract.connect(executor).executeWithdrawal(
      { ...auth.value, reservationId: ethers.id("different-id") }, auth.signature
    )).to.be.revertedWithCustomError(contract, "InvalidAuthorization");
  });

  it("rejects malformed, wrong-signer, and executor-invented signatures", async function () {
    const auth = await makeAuthorization();
    await expect(contract.connect(executor).executeWithdrawal(auth.value, "0x1234"))
      .to.be.revertedWithCustomError(contract, "InvalidAuthorization");
    const wrong = await makeAuthorization({}, other);
    await expect(contract.connect(executor).executeWithdrawal(wrong.value, wrong.signature))
      .to.be.revertedWithCustomError(contract, "InvalidAuthorization");
    const invented = await makeAuthorization({}, executor);
    await expect(contract.connect(executor).executeWithdrawal(invented.value, invented.signature))
      .to.be.revertedWithCustomError(contract, "InvalidAuthorization");
  });

  it("keeps executor and authorizer roles separated", async function () {
    await expect(contract.grantRole(await contract.AUTHORIZER_ROLE(), executor.address))
      .to.be.revertedWithCustomError(contract, "RoleSeparationRequired");
    await expect(contract.grantRole(await contract.WITHDRAWAL_EXECUTOR_ROLE(), authorizer.address))
      .to.be.revertedWithCustomError(contract, "RoleSeparationRequired");
  });

  it("rejects wrong chain and wrong contract domains", async function () {
    const wrongChain = await makeAuthorization({ chainId: 97n });
    await expect(contract.connect(executor).executeWithdrawal(wrongChain.value, wrongChain.signature))
      .to.be.revertedWithCustomError(contract, "WrongAuthorizationDomain");
    const wrongContract = await makeAuthorization({ verifyingContract: other.address });
    await expect(contract.connect(executor).executeWithdrawal(wrongContract.value, wrongContract.signature))
      .to.be.revertedWithCustomError(contract, "WrongAuthorizationDomain");
  });

  it("rejects altered user, destination, and amounts", async function () {
    const auth = await makeAuthorization();
    for (const altered of [
      { ...auth.value, user: other.address },
      { ...auth.value, destination: other.address },
      { ...auth.value, netAmount: 800_000n, feeAmount: 200_000n },
    ]) {
      await expect(contract.connect(executor).executeWithdrawal(altered, auth.signature))
        .to.be.revertedWithCustomError(contract, "InvalidAuthorization");
    }
  });

  it("rejects expired authorizations", async function () {
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const auth = await makeAuthorization({ deadline: now - 1n });
    await expect(contract.connect(executor).executeWithdrawal(auth.value, auth.signature))
      .to.be.revertedWithCustomError(contract, "AuthorizationExpired");
  });

  it("rejects cross-contract replay", async function () {
    const second = await (await ethers.getContractFactory("SmartEarning")).deploy(
      await token.getAddress(), genesis.address, admin.address, treasury.address, authorizer.address
    );
    await second.grantRole(await second.WITHDRAWAL_EXECUTOR_ROLE(), executor.address);
    const auth = await makeAuthorization();
    await expect(second.connect(executor).executeWithdrawal(auth.value, auth.signature))
      .to.be.revertedWithCustomError(second, "WrongAuthorizationDomain");
  });

  it("scopes identical Booster references by user and rejects exact replay", async function () {
    for (const account of [user, other]) {
      await token.mint(account.address, 4n * DOLLAR);
      await token.connect(account).approve(await contract.getAddress(), 4n * DOLLAR);
      await contract.connect(account).register(genesis.address);
    }
    const source = ethers.id("shared-booster-reference");
    await contract.connect(user).topupBooster(DOLLAR, source);
    await contract.connect(other).topupBooster(DOLLAR, source);
    await expect(contract.connect(user).topupBooster(DOLLAR, source))
      .to.be.revertedWithCustomError(contract, "PaymentSourceAlreadyProcessed");
    const type = ethers.id("BOOSTER_TOP_UP");
    expect(await contract.paymentSourceKey(user.address, type, DOLLAR, source))
      .not.to.equal(await contract.paymentSourceKey(other.address, type, DOLLAR, source));
  });

  it("rejects zero references consistently and cannot set treasury to itself", async function () {
    await expect(contract.makePlatformPayment(ethers.id("OTHER"), 1n, ethers.ZeroHash))
      .to.be.revertedWithCustomError(contract, "InvalidSourceReference");
    await expect(contract.connect(treasury).fundWithdrawalLiquidity(1n, ethers.ZeroHash))
      .to.be.revertedWithCustomError(contract, "InvalidSourceReference");
    await contract.grantRole(await contract.MAGIC_FUNDING_ROLE(), admin.address);
    await expect(contract.fundMagic(genesis.address, 1n, ethers.ZeroHash))
      .to.be.revertedWithCustomError(contract, "InvalidSourceReference");
    await expect(contract.setTreasuryWallet(await contract.getAddress()))
      .to.be.revertedWithCustomError(contract, "ZeroAddress");
  });

  it("has no legacy replayable recordPackagePurchase selector", async function () {
    const selector = ethers.id("recordPackagePurchase(address,uint256)").slice(0, 10);
    await expect(admin.sendTransaction({ to: await contract.getAddress(), data: selector }))
      .to.be.reverted;
  });
});
