const { expect } = require("chai");
const { ethers } = require("hardhat");
describe("SmartEarning unified registration and Magic", function () {
  const dollar = 1_000_000n;
  let token, plan, admin, genesis, alice, bob, carol, dave, eve;
  beforeEach(async function () {
    [admin, genesis, alice, bob, carol, dave, eve] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockUSDT")).deploy();
    plan = await (await ethers.getContractFactory("SmartEarning")).deploy(await token.getAddress(), genesis.address, admin.address, admin.address, eve.address);
    for (const user of [alice, bob, carol, dave, eve]) { await token.mint(user.address, 10n*dollar); await token.connect(user).approve(await plan.getAddress(), 10n*dollar); }
  });
  it("registers atomically, forwards treasury payment, and credits Magic accounting", async function () {
    const before=await token.balanceOf(admin.address);
    await expect(plan.connect(alice).register(genesis.address)).to.emit(plan,"UserRegistered").withArgs(alice.address,genesis.address,genesis.address,1n,0,0,dollar);
    expect(await token.balanceOf(admin.address)).to.equal(before+2n*dollar);
    expect(await token.balanceOf(await plan.getAddress())).to.equal(0);
    expect(await plan.magicBalance(alice.address)).to.equal(dollar);
    expect(await plan.magicBalance(genesis.address)).to.equal(0);
  });
  it("rejects duplicate, self, and nonexistent sponsors", async function () {
    await expect(plan.connect(alice).register(alice.address)).to.be.revertedWithCustomError(plan,"SelfReferral");
    await expect(plan.connect(alice).register(bob.address)).to.be.revertedWithCustomError(plan,"SponsorNotRegistered");
    await plan.connect(alice).register(genesis.address);
    await expect(plan.connect(alice).register(genesis.address)).to.be.revertedWithCustomError(plan,"AlreadyRegistered");
  });
  it("places B referrals below B's already occupied global children",async function(){
    const signers=await ethers.getSigners(),[B,C,D,E,X,Y]=signers.slice(7,13);
    await plan.connect(alice).register(genesis.address);
    for(const member of[B,C,D,E,X,Y]){await token.mint(member.address,member===B?10n*dollar:2n*dollar);await token.connect(member).approve(await plan.getAddress(),member===B?10n*dollar:2n*dollar)}
    for(const member of[B,C,D,E])await plan.connect(member).register(alice.address);
    await plan.connect(X).register(B.address);await plan.connect(Y).register(B.address);
    expect(await plan.matrixParentOf(B.address)).to.equal(alice.address);
    expect(await plan.matrixParentOf(C.address)).to.equal(alice.address);
    expect(await plan.matrixParentOf(D.address)).to.equal(B.address);
    expect(await plan.matrixParentOf(E.address)).to.equal(B.address);
    expect(await plan.matrixParentOf(X.address)).to.equal(D.address);
    expect(await plan.matrixParentOf(Y.address)).to.equal(D.address);
    const[aLeft,aRight]=await plan.getMatrixChildren(alice.address);
    const[bLeft,bRight]=await plan.getMatrixChildren(B.address);
    const[dLeft,dRight]=await plan.getMatrixChildren(D.address);
    expect([aLeft,aRight]).to.deep.equal([B.address,C.address]);
    expect([bLeft,bRight]).to.deep.equal([D.address,E.address]);
    expect([dLeft,dRight]).to.deep.equal([X.address,Y.address]);
    for(const node of[alice,B,C,D,E,X,Y])expect(await plan.getMatrixChildCount(node.address)).to.be.lte(2n);
    await plan.connect(B).purchasePackage(1,8n*dollar);
    const magicBefore=await plan.magicBalance(B.address);await plan.distributeBatch([X.address],await plan.currentCycle());
    expect(await plan.pendingUnqualified(D.address,1)).to.equal(50_000n);
    expect(await plan.claimableMagicIncome(B.address)).to.equal(45_000n);
    expect(await plan.magicBalance(B.address)).to.equal(magicBefore+5_000n);
  });
  it("never leaves the sponsor's actual descendant subtree",async function(){
    const signers=await ethers.getSigners(),x=alice,y=bob,xMembers=signers.slice(7,10),yMembers=signers.slice(10,13);
    await plan.connect(x).register(genesis.address);await plan.connect(y).register(genesis.address);
    for(const member of[...xMembers,...yMembers]){await token.mint(member.address,2n*dollar);await token.connect(member).approve(await plan.getAddress(),2n*dollar)}
    for(const member of xMembers)await plan.connect(member).register(x.address);
    for(const member of yMembers)await plan.connect(member).register(y.address);
    expect(await plan.matrixParentOf(xMembers[2].address)).to.equal(xMembers[0].address);
    expect(await plan.matrixParentOf(yMembers[2].address)).to.equal(yMembers[0].address);
    const[xLeft,xRight]=await plan.getMatrixChildren(x.address);
    const[yLeft,yRight]=await plan.getMatrixChildren(y.address);
    expect([xLeft,xRight]).to.deep.equal([xMembers[0].address,xMembers[1].address]);
    expect([yLeft,yRight]).to.deep.equal([yMembers[0].address,yMembers[1].address]);
    async function descendsFrom(node,root){let cursor=node;for(let i=0;i<20&&cursor!==ethers.ZeroAddress;i++){if(cursor===root)return true;cursor=await plan.matrixParentOf(cursor)}return false}
    for(const member of xMembers){expect(await descendsFrom(member.address,x.address)).to.equal(true);expect(await descendsFrom(member.address,y.address)).to.equal(false)}
    for(const member of yMembers){expect(await descendsFrom(member.address,y.address)).to.equal(true);expect(await descendsFrom(member.address,x.address)).to.equal(false)}
  });
  it("never changes referral sponsor or matrix parent after placement",async function(){
    await plan.connect(alice).register(genesis.address);await plan.connect(bob).register(alice.address);
    const sponsor=await plan.sponsorOf(bob.address),parent=await plan.matrixParentOf(bob.address);
    await plan.connect(carol).register(alice.address);await plan.connect(dave).register(alice.address);
    expect(await plan.sponsorOf(bob.address)).to.equal(sponsor);
    expect(await plan.matrixParentOf(bob.address)).to.equal(parent);
    expect(sponsor).to.equal(alice.address);expect(parent).to.equal(alice.address);
  });
  it("advances a bounded sponsor BFS cursor without accepting an arbitrary parent",async function(){
    await plan.connect(alice).register(genesis.address);
    await plan.connect(bob).register(alice.address);await plan.connect(carol).register(alice.address);
    expect(await plan.advancePlacementCursor.staticCall(alice.address,1)).to.equal(false);
    await plan.advancePlacementCursor(alice.address,1);
    const[head,size]=await plan.getPlacementQueueState(alice.address);
    expect(head).to.equal(1);expect(size).to.equal(3);
    await plan.connect(dave).register(alice.address);
    expect(await plan.matrixParentOf(dave.address)).to.equal(bob.address);
  });
  it("requires and safely continues beyond 64 stale sponsor cursor steps",async function(){
    this.timeout(120000);
    await plan.connect(alice).register(genesis.address);
    const nodes=[alice];
    for(let parentIndex=0;parentIndex<65;parentIndex++){
      for(let side=0;side<2;side++){
        const member=ethers.Wallet.createRandom().connect(ethers.provider);
        await ethers.provider.send("hardhat_setBalance",[member.address,"0x8AC7230489E80000"]);
        await token.mint(member.address,2n*dollar);
        await token.connect(member).approve(await plan.getAddress(),2n*dollar);
        await plan.connect(member).register(nodes[parentIndex].address);
        nodes.push(member);
      }
    }
    const newcomer=ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance",[newcomer.address,"0x8AC7230489E80000"]);
    await token.mint(newcomer.address,2n*dollar);
    await token.connect(newcomer).approve(await plan.getAddress(),2n*dollar);
    await expect(plan.connect(newcomer).register(alice.address))
      .to.be.revertedWithCustomError(plan,"PlacementSearchNeedsAdvance");
    expect(await plan.advancePlacementCursor.staticCall(alice.address,64)).to.equal(false);
    await plan.advancePlacementCursor(alice.address,64);
    expect(await plan.advancePlacementCursor.staticCall(alice.address,64)).to.equal(true);
    await plan.advancePlacementCursor(alice.address,64);
    await plan.connect(newcomer).register(alice.address);
    expect(await plan.matrixParentOf(newcomer.address)).to.equal(nodes[65].address);
  });
  it("distributes $0.05 at 20 levels and prevents replay", async function () {
    await plan.connect(alice).register(genesis.address);await plan.connect(bob).register(genesis.address);await plan.connect(carol).register(alice.address);
    await plan.connect(alice).purchasePackage(1,8n*dollar);await token.mint(genesis.address,8n*dollar);await token.connect(genesis).approve(await plan.getAddress(),8n*dollar);await plan.connect(genesis).purchasePackage(1,8n*dollar);
    const cycle=await plan.currentCycle();await plan.distributeBatch([carol.address],cycle);
    expect(await plan.magicBalance(carol.address)).to.equal(0);expect(await plan.claimableMagicIncome(alice.address)).to.equal(45_000n);expect(await plan.claimableMagicIncome(genesis.address)).to.equal(45_000n);expect(await plan.pendingNoUpline(carol.address,20)).to.equal(50_000n);
    await expect(plan.distributeBatch([carol.address],cycle)).to.be.revertedWithCustomError(plan,"AlreadyDistributed");
  });
  it("stores unqualified allocations as pending", async function () {
    await plan.connect(alice).register(genesis.address);await plan.connect(bob).register(genesis.address);await plan.connect(carol).register(genesis.address);await plan.connect(dave).register(genesis.address);await plan.connect(eve).register(genesis.address);
    await plan.distributeBatch([eve.address],await plan.currentCycle());
    expect(await plan.pendingUnqualified(bob.address,1)).to.equal(50_000n);expect(await plan.claimableMagicIncome(bob.address)).to.equal(0);
  });
  it("enforces qualification and batch/balance rules", async function () {
    for(let level=1;level<=20;level++)expect(await plan.requiredDirects(level)).to.equal(BigInt(Math.ceil(level/2)));
    await expect(plan.distributeBatch([],await plan.currentCycle())).to.be.revertedWithCustomError(plan,"InvalidBatchSize");
    await expect(plan.distributeBatch([alice.address],await plan.currentCycle())).to.be.revertedWithCustomError(plan,"InsufficientMagicBalance");
  });
});
