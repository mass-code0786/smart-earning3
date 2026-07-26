// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Registration and 20-level Magic distribution for Smart Earning.
/// @dev USDT never pays gas; callers always pay network gas separately in BNB.
contract SmartEarning is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MAGIC_FUNDING_ROLE = keccak256("MAGIC_FUNDING_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant WITHDRAWAL_EXECUTOR_ROLE = keccak256("WITHDRAWAL_EXECUTOR_ROLE");
    bytes32 public constant AUTHORIZER_ROLE = keccak256("AUTHORIZER_ROLE");
    bytes32 public constant WITHDRAWAL_AUTHORIZATION_TYPEHASH = keccak256(
        "WithdrawalAuthorization(bytes32 payoutType,bytes32 reservationId,bytes32 earningSource,address user,uint256 chainId,address verifyingContract,uint256 grossAmount,uint256 feeAmount,uint256 netAmount,address destination,uint256 issuedAt,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant _EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant _EIP712_NAME_HASH = keccak256("SmartEarning");
    bytes32 private constant _EIP712_VERSION_HASH = keccak256("1");
    uint8 public constant MAX_LEVELS = 20;
    uint8 public constant PACKAGE_COUNT = 8;
    uint256 public constant REGISTRATION_SEARCH_STEPS = 64;
    uint256 public constant MAX_CURSOR_ADVANCE_STEPS = 256;

    IERC20 public immutable usdt;
    uint256 public immutable oneDollar;
    uint256 public immutable registrationPrice;
    uint256 public immutable levelPayment;
    address public treasuryWallet;
    bool public paymentsPaused;
    bool public withdrawalsPaused;
    bool public x3PlacementPaused;
    bool public x4PlacementPaused;

    mapping(address => bool) public registered;
    mapping(address => address) public sponsorOf;
    mapping(address => uint256) public directCount;
    mapping(address => address) public matrixParentOf;
    mapping(address => uint256) public matrixIndexOf;
    mapping(address => uint256) public magicBalance;
    mapping(address => uint256) public claimableMagicIncome;
    mapping(address => mapping(uint8 => uint256)) public pendingUnqualified;
    mapping(address => mapping(uint8 => uint256)) public pendingNoUpline;
    mapping(address => uint256) public lastDistributedCycle;
    mapping(address => uint256) public totalEligibleValue;
    mapping(address => uint256) public totalEarningCap;
    mapping(address => uint256) public totalEarned;
    mapping(address => mapping(bytes32 => uint256)) public cappedExcess;
    mapping(bytes32 => bool) public processedMagicFunding;
    mapping(address => uint8) public highestPackageId;
    mapping(address => uint256) public totalPackageValue;
    mapping(address => mapping(uint8 => bool)) public hasPurchasedPackage;
    mapping(bytes32 => bool) public processedPaymentSources;
    mapping(bytes32 => bool) public processedTreasuryFunding;
    mapping(bytes32 => bool) public processedWithdrawals;
    uint256 public withdrawalLiquidityFunded;
    uint256 public withdrawalLiquidityPaid;
    mapping(uint8 => address[]) private _x3Queue;
    mapping(uint8 => uint256) private _x3QueueHead;
    mapping(uint8 => mapping(address => uint8)) public x3SlotCount;
    mapping(uint8 => mapping(address => uint256)) public x3CycleNumber;
    mapping(uint8 => mapping(address => uint256)) public x3HeldIncome;
    mapping(uint8 => address[]) private _x4Queue;
    mapping(uint8 => uint256) private _x4QueueHead;
    mapping(uint8 => mapping(address => uint8)) public x4SlotCount;
    mapping(uint8 => mapping(address => uint256)) public x4CycleNumber;

    address[] private _registeredUsers;
    mapping(address => address[2]) private _matrixChildren;
    mapping(address => uint8) private _matrixChildCount;
    mapping(address => address[]) private _placementQueue;
    mapping(address => uint256) private _placementQueueHead;

    error AlreadyRegistered();
    error SponsorNotRegistered();
    error SelfReferral();
    error UnsupportedTokenDecimals();
    error UnexpectedTokenTransfer();
    error InsufficientMagicBalance();
    error AlreadyDistributed();
    error InvalidCycle();
    error InvalidBatchSize();
    error NothingToClaim();
    error ZeroAddress();
    error InvalidAdvanceSteps();
    error PlacementSearchNeedsAdvance(address sponsor, uint256 queueHead);
    error FundingAlreadyProcessed();
    error PaymentsPaused();
    error WithdrawalsPaused();
    error InvalidPackageId();
    error WrongNextPackage(uint8 expected, uint8 supplied);
    error PackageAlreadyPurchased();
    error WrongPaymentAmount(uint256 expected, uint256 received);
    error PaymentSourceAlreadyProcessed();
    error WithdrawalAlreadyProcessed();
    error InvalidWithdrawalAmounts();
    error InsufficientWithdrawalLiquidity();
    error InvalidAuthorization();
    error AuthorizationExpired();
    error WrongAuthorizationDomain();
    error RoleSeparationRequired();
    error PlacementModulePaused();
    error InvalidSourceReference();

    event UserRegistered(
        address indexed user,
        address indexed sponsor,
        address indexed matrixParent,
        uint256 matrixIndex,
        uint8 matrixPosition,
        uint256 directSponsorIncome,
        uint256 magicWalletCredit
    );
    event MagicDistributed(
        uint256 indexed cycleId,
        address indexed source,
        uint256 distributed,
        uint256 qualifiedAmount,
        uint256 pendingAmount
    );
    event MagicLevelAllocated(
        uint256 indexed cycleId,
        address indexed source,
        address indexed beneficiary,
        uint8 level,
        uint256 amount,
        bool qualified
    );
    event MagicIncomeClaimed(address indexed beneficiary, uint256 amount);
    event MagicFunded(address indexed user, bytes32 indexed sourceReference, uint256 amount);
    event EarningSplit(address indexed user, bytes32 indexed incomeType, uint256 gross, uint256 magicAmount, uint256 incomeAmount);
    event EarningCapIncreased(
        address indexed user,
        uint256 previousCap,
        uint256 increaseAmount,
        uint256 newCap
    );
    event IncomeCapped(
        address indexed user,
        bytes32 indexed incomeType,
        uint256 calculatedAmount,
        uint256 creditedAmount,
        uint256 cappedExcessAmount
    );
    event PlacementCursorAdvanced(
        address indexed sponsor,
        uint256 previousHead,
        uint256 newHead,
        bool availablePositionFound
    );
    event PaymentReceived(address indexed user, bytes32 indexed paymentType, uint256 grossAmount, uint256 treasuryAmount, bytes32 sourceReference, uint256 timestamp);
    event RegistrationCompleted(address indexed user, uint256 grossAmount, uint256 treasuryAmount, bytes32 indexed sourceReference, uint256 timestamp);
    event PackagePurchased(address indexed user,uint8 indexed packageId,uint256 amount,uint256 totalPackageValue,uint256 newEarningCap,uint256 timestamp);
    event MagicFundingRecorded(address indexed user,bytes32 indexed paymentType,uint256 grossAmount,uint256 accountingAmount,bytes32 sourceReference,uint256 timestamp);
    event TreasuryFunded(address indexed user,bytes32 indexed paymentType,uint256 grossAmount,uint256 treasuryAmount,bytes32 sourceReference,uint256 timestamp);
    event TreasuryWalletUpdated(address indexed previousTreasury,address indexed newTreasury,address indexed changedBy);
    event WithdrawalLiquidityFunded(bytes32 indexed sourceReference,address indexed treasury,uint256 amount,uint256 contractBalance);
    event WithdrawalPaid(bytes32 indexed reservationHash,bytes32 indexed reservationId,address indexed user,address destination,bytes32 payoutType,bytes32 earningSource,uint256 grossReservedAmount,uint256 feeAmount,uint256 netAmount,uint256 nonce,address executor,address authorizer);
    event PaymentPauseChanged(bool paused);
    event WithdrawalPauseChanged(bool paused);
    event X3Placed(address indexed user,address indexed owner,uint8 indexed packageId,uint8 slot,uint256 allocation,uint256 cycle);
    event X3Recycled(address indexed owner,uint8 indexed packageId,uint256 completedCycle,uint256 newCycle);
    event X4Placed(address indexed user,address indexed owner,uint8 indexed packageId,uint8 slot,uint8 level,uint256 accountingAmount,uint256 cycle);
    event X4Recycled(address indexed owner,uint8 indexed packageId,uint256 completedCycle,uint256 newCycle);
    event BoosterTopup(address indexed user,uint256 amount,bytes32 indexed sourceReference);

    struct WithdrawalAuthorization {
        bytes32 payoutType;
        bytes32 reservationId;
        bytes32 earningSource;
        address user;
        uint256 chainId;
        address verifyingContract;
        uint256 grossAmount;
        uint256 feeAmount;
        uint256 netAmount;
        address destination;
        uint256 issuedAt;
        uint256 nonce;
        uint256 deadline;
    }

    constructor(address usdtAddress, address genesisUser, address admin, address treasury, address authorizer) {
        if (usdtAddress == address(0) || genesisUser == address(0) || admin == address(0) || treasury == address(0) || authorizer == address(0)) {
            revert ZeroAddress();
        }
        if (treasury == address(this)) revert ZeroAddress();
        if (authorizer == admin) revert RoleSeparationRequired();

        uint8 decimals = IERC20Metadata(usdtAddress).decimals();
        if (decimals < 2 || decimals > 18) revert UnsupportedTokenDecimals();

        usdt = IERC20(usdtAddress);
        oneDollar = 10 ** decimals;
        registrationPrice = 2 * (10 ** decimals);
        levelPayment = (10 ** decimals) / MAX_LEVELS;
        treasuryWallet = treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(TREASURY_ROLE, treasury);
        _grantRole(WITHDRAWAL_EXECUTOR_ROLE, admin);
        _grantRole(AUTHORIZER_ROLE, authorizer);

        registered[genesisUser] = true;
        matrixIndexOf[genesisUser] = 0;
        totalEligibleValue[genesisUser] = registrationPrice;
        totalEarningCap[genesisUser] = registrationPrice * 5;
        _registeredUsers.push(genesisUser);
    }

    function register(address sponsor) external nonReentrant whenNotPaused {
        if (paymentsPaused) revert PaymentsPaused();
        address user = msg.sender;
        if (registered[user]) revert AlreadyRegistered();
        if (sponsor == user) revert SelfReferral();
        if (!registered[sponsor]) revert SponsorNotRegistered();

        (address parent, uint8 position) = _findPlacement(
            sponsor,
            REGISTRATION_SEARCH_STEPS
        );
        uint256 index = _registeredUsers.length;
        bytes32 sourceReference = keccak256(abi.encodePacked("REGISTRATION", user));
        bytes32 paymentSourceKey_ = _paymentSourceKey(user, keccak256("REGISTRATION"), registrationPrice, sourceReference);
        if (processedPaymentSources[paymentSourceKey_]) revert PaymentSourceAlreadyProcessed();

        uint256 beforeBalance = usdt.balanceOf(address(this));
        usdt.safeTransferFrom(user, address(this), registrationPrice);
        if (usdt.balanceOf(address(this)) - beforeBalance != registrationPrice) {
            revert UnexpectedTokenTransfer();
        }

        // State is finalized before the external sponsor transfer. A revert from
        // USDT rolls the complete transaction back.
        registered[user] = true;
        sponsorOf[user] = sponsor;
        directCount[sponsor] += 1;
        matrixParentOf[user] = parent;
        matrixIndexOf[user] = index;
        magicBalance[user] = oneDollar;
        totalEligibleValue[user] = registrationPrice;
        totalEarningCap[user] = registrationPrice * 5;
        _registeredUsers.push(user);
        _matrixChildren[parent][position] = user;
        _matrixChildCount[parent] += 1;
        processedPaymentSources[paymentSourceKey_] = true;

        uint256 sponsorCredit = _applyIncomeCap(
            sponsor,
            keccak256("DIRECT_INCOME"),
            oneDollar
        );
        _splitEarning(sponsor, keccak256("DIRECT_INCOME"), sponsorCredit);
        usdt.safeTransfer(treasuryWallet, registrationPrice);
        emit PaymentReceived(user,keccak256("REGISTRATION"),registrationPrice,registrationPrice,sourceReference,block.timestamp);
        emit MagicFundingRecorded(user,keccak256("REGISTRATION"),registrationPrice,oneDollar,sourceReference,block.timestamp);
        emit TreasuryFunded(user,keccak256("REGISTRATION"),registrationPrice,registrationPrice,sourceReference,block.timestamp);
        emit RegistrationCompleted(user,registrationPrice,registrationPrice,sourceReference,block.timestamp);
        emit UserRegistered(
            user,
            sponsor,
            parent,
            index,
            position,
            sponsorCredit,
            oneDollar
        );
    }

    function purchasePackage(uint8 packageId,uint256 amount) external nonReentrant whenNotPaused {
        if (paymentsPaused) revert PaymentsPaused();
        address user=msg.sender;
        if(!registered[user]) revert SponsorNotRegistered();
        if(packageId==0||packageId>PACKAGE_COUNT) revert InvalidPackageId();
        if(hasPurchasedPackage[user][packageId]) revert PackageAlreadyPurchased();
        uint8 expected=getNextPackage(user);
        if(packageId!=expected) revert WrongNextPackage(expected,packageId);
        uint256 price=getPackagePrice(packageId);
        if(amount!=price) revert WrongPaymentAmount(price,amount);
        bytes32 sourceReference=keccak256(abi.encodePacked("PACKAGE",user,packageId));
        bytes32 paymentSourceKey_=_paymentSourceKey(user,keccak256("PACKAGE"),amount,sourceReference);
        if(processedPaymentSources[paymentSourceKey_]) revert PaymentSourceAlreadyProcessed();
        uint256 beforeBalance=usdt.balanceOf(address(this));
        usdt.safeTransferFrom(user,address(this),amount);
        if(usdt.balanceOf(address(this))-beforeBalance!=amount) revert UnexpectedTokenTransfer();
        hasPurchasedPackage[user][packageId]=true;
        highestPackageId[user]=packageId;
        totalPackageValue[user]+=amount;
        processedPaymentSources[paymentSourceKey_]=true;
        uint256 previousCap=totalEarningCap[user];
        uint256 increase=amount*5;
        totalEligibleValue[user]+=amount;
        totalEarningCap[user]=previousCap+increase;
        uint256 magicAmount=amount/8;
        magicBalance[user]+=magicAmount;
        processedMagicFunding[sourceReference]=true;
        _processX3Package(user,packageId,amount);
        _processX4Package(user,packageId,amount);
        usdt.safeTransfer(treasuryWallet,amount);
        emit PaymentReceived(user,keccak256("PACKAGE"),amount,amount,sourceReference,block.timestamp);
        emit EarningCapIncreased(user,previousCap,increase,previousCap+increase);
        emit MagicFunded(user,sourceReference,magicAmount);
        emit MagicFundingRecorded(user,keccak256("PACKAGE"),amount,magicAmount,sourceReference,block.timestamp);
        emit TreasuryFunded(user,keccak256("PACKAGE"),amount,amount,sourceReference,block.timestamp);
        emit PackagePurchased(user,packageId,amount,totalPackageValue[user],totalEarningCap[user],block.timestamp);
    }

    function _processX3Package(address user,uint8 packageId,uint256 amount) private {
        if(x3PlacementPaused) revert PlacementModulePaused();
        address[] storage queue=_x3Queue[packageId];
        x3CycleNumber[packageId][user]+=1;
        if(queue.length==0){queue.push(user);emit X3Placed(user,address(0),packageId,0,amount/4,x3CycleNumber[packageId][user]);return;}
        uint256 head=_x3QueueHead[packageId];
        while(head<queue.length&&x3SlotCount[packageId][queue[head]]>=3){unchecked{++head;}}
        if(head>=queue.length)revert PlacementModulePaused();
        address owner=queue[head];uint8 slot=++x3SlotCount[packageId][owner];uint256 allocation=amount/4;
        if(slot<3){uint256 credit=_applyIncomeCap(owner,keccak256("X3_PACKAGE"),allocation);_splitEarning(owner,keccak256("X3_PACKAGE"),credit);}
        else{uint256 completed=x3CycleNumber[packageId][owner];x3CycleNumber[packageId][owner]=completed+1;x3SlotCount[packageId][owner]=0;queue.push(owner);_x3QueueHead[packageId]=head+1;emit X3Recycled(owner,packageId,completed,completed+1);}
        queue.push(user);emit X3Placed(user,owner,packageId,slot,allocation,x3CycleNumber[packageId][user]);
    }

    function _processX4Package(address user,uint8 packageId,uint256 amount) private {
        if(x4PlacementPaused) revert PlacementModulePaused();
        address[] storage queue=_x4Queue[packageId];
        x4CycleNumber[packageId][user]+=1;
        if(queue.length==0){queue.push(user);emit X4Placed(user,address(0),packageId,0,0,0,x4CycleNumber[packageId][user]);return;}
        uint256 head=_x4QueueHead[packageId];
        while(head<queue.length&&x4SlotCount[packageId][queue[head]]>=6){unchecked{++head;}}
        if(head>=queue.length)revert PlacementModulePaused();
        address owner=queue[head];uint8 slot=++x4SlotCount[packageId][owner];uint8 level=slot<=2?1:2;uint256 classified;
        if(level==1){classified=amount/16;magicBalance[owner]+=classified;emit MagicFundingRecorded(owner,slot==1?keccak256("X4_A"):keccak256("X4_B"),amount,classified,keccak256(abi.encodePacked("X4",packageId,owner,user,slot,x4CycleNumber[packageId][owner])),block.timestamp);}
        else{classified=amount*5/32;uint256 credit=_applyIncomeCap(owner,keccak256("X4_GLOBAL"),classified);_splitEarning(owner,keccak256("X4_GLOBAL"),credit);}
        if(slot==6){uint256 completed=x4CycleNumber[packageId][owner];x4CycleNumber[packageId][owner]=completed+1;x4SlotCount[packageId][owner]=0;queue.push(owner);_x4QueueHead[packageId]=head+1;emit X4Recycled(owner,packageId,completed,completed+1);}
        queue.push(user);emit X4Placed(user,owner,packageId,slot,level,classified,x4CycleNumber[packageId][user]);
    }

    function makePlatformPayment(bytes32 paymentType,uint256 amount,bytes32 sourceReference) external nonReentrant whenNotPaused {
        if(paymentsPaused) revert PaymentsPaused();
        if(amount==0) revert UnexpectedTokenTransfer();
        if(sourceReference==bytes32(0)) revert InvalidSourceReference();
        bytes32 paymentSourceKey_=_paymentSourceKey(msg.sender,paymentType,amount,sourceReference);
        if(processedPaymentSources[paymentSourceKey_]) revert PaymentSourceAlreadyProcessed();
        uint256 beforeBalance=usdt.balanceOf(address(this));
        usdt.safeTransferFrom(msg.sender,address(this),amount);
        if(usdt.balanceOf(address(this))-beforeBalance!=amount) revert UnexpectedTokenTransfer();
        processedPaymentSources[paymentSourceKey_]=true;
        usdt.safeTransfer(treasuryWallet,amount);
        emit PaymentReceived(msg.sender,paymentType,amount,amount,sourceReference,block.timestamp);
        emit TreasuryFunded(msg.sender,paymentType,amount,amount,sourceReference,block.timestamp);
    }

    /// @notice Adds confirmed USDT value to the off-chain Booster Wallet ledger.
    /// @dev This function deliberately changes no package, matrix, cap, Magic,
    /// Dividend, referral, or earning state. The emitted event is the backend's
    /// idempotent credit authority after confirmation.
    function topupBooster(uint256 amount,bytes32 sourceReference) external nonReentrant whenNotPaused {
        if(paymentsPaused) revert PaymentsPaused();
        if(!registered[msg.sender]) revert SponsorNotRegistered();
        if(amount==0) revert UnexpectedTokenTransfer();
        if(sourceReference==bytes32(0)) revert InvalidSourceReference();
        bytes32 paymentSourceKey_=_paymentSourceKey(msg.sender,keccak256("BOOSTER_TOP_UP"),amount,sourceReference);
        if(processedPaymentSources[paymentSourceKey_]) revert PaymentSourceAlreadyProcessed();
        uint256 beforeBalance=usdt.balanceOf(address(this));
        usdt.safeTransferFrom(msg.sender,address(this),amount);
        if(usdt.balanceOf(address(this))-beforeBalance!=amount) revert UnexpectedTokenTransfer();
        processedPaymentSources[paymentSourceKey_]=true;
        usdt.safeTransfer(treasuryWallet,amount);
        if(usdt.balanceOf(address(this))!=beforeBalance) revert UnexpectedTokenTransfer();
        emit PaymentReceived(msg.sender,keccak256("BOOSTER_TOP_UP"),amount,amount,sourceReference,block.timestamp);
        emit TreasuryFunded(msg.sender,keccak256("BOOSTER_TOP_UP"),amount,amount,sourceReference,block.timestamp);
        emit BoosterTopup(msg.sender,amount,sourceReference);
    }

    function getPackagePrice(uint8 packageId) public view returns(uint256){
        if(packageId==0||packageId>PACKAGE_COUNT) revert InvalidPackageId();
        return oneDollar*(uint256(1)<<packageId)*4;
    }
    function getNextPackage(address user) public view returns(uint8){uint8 current=highestPackageId[user];return current>=PACKAGE_COUNT?0:current+1;}
    function getPurchasedPackages(address user) external view returns(bool[8] memory values){for(uint8 i=1;i<=PACKAGE_COUNT;++i)values[i-1]=hasPurchasedPackage[user][i];}
    function getTotalPackageValue(address user) external view returns(uint256){return totalPackageValue[user];}
    function getTotalEligibleValue(address user) external view returns(uint256){return totalEligibleValue[user];}
    function getTotalEarningCap(address user) external view returns(uint256){return totalEarningCap[user];}
    function getTotalEarned(address user) external view returns(uint256){return totalEarned[user];}

    function fundWithdrawalLiquidity(uint256 amount,bytes32 sourceReference) external onlyRole(TREASURY_ROLE) nonReentrant {
        if(amount==0) revert UnexpectedTokenTransfer();
        if(sourceReference==bytes32(0)) revert InvalidSourceReference();
        if(processedTreasuryFunding[sourceReference]) revert FundingAlreadyProcessed();
        if(msg.sender!=treasuryWallet) revert ZeroAddress();
        uint256 beforeBalance=usdt.balanceOf(address(this));
        processedTreasuryFunding[sourceReference]=true;
        usdt.safeTransferFrom(treasuryWallet,address(this),amount);
        if(usdt.balanceOf(address(this))-beforeBalance!=amount) revert UnexpectedTokenTransfer();
        withdrawalLiquidityFunded+=amount;
        emit WithdrawalLiquidityFunded(sourceReference,treasuryWallet,amount,usdt.balanceOf(address(this)));
    }

    /// @dev Financial calculations remain off-chain. The immutable EIP-712
    /// authorization is the payout security boundary and cannot be altered by
    /// the executor.
    function executeWithdrawal(WithdrawalAuthorization calldata authorization,bytes calldata signature) external onlyRole(WITHDRAWAL_EXECUTOR_ROLE) nonReentrant whenNotPaused {
        if(withdrawalsPaused) revert WithdrawalsPaused();
        if(authorization.reservationId==bytes32(0)||authorization.earningSource==bytes32(0)||authorization.payoutType==bytes32(0)) revert InvalidSourceReference();
        if(authorization.chainId!=block.chainid||authorization.verifyingContract!=address(this)) revert WrongAuthorizationDomain();
        if(authorization.deadline<block.timestamp) revert AuthorizationExpired();
        if(authorization.issuedAt>block.timestamp||authorization.deadline<authorization.issuedAt) revert InvalidAuthorization();
        bytes32 reservationHash=withdrawalAuthorizationHash(authorization);
        if(processedWithdrawals[reservationHash]) revert WithdrawalAlreadyProcessed();
        (address authorizer,ECDSA.RecoverError recoverError,)=ECDSA.tryRecover(reservationHash,signature);
        if(recoverError!=ECDSA.RecoverError.NoError||!hasRole(AUTHORIZER_ROLE,authorizer)) revert InvalidAuthorization();
        uint256 expectedFee=authorization.grossAmount*1000/10_000;
        if(authorization.user==address(0)||authorization.destination==address(0)||authorization.netAmount==0||authorization.grossAmount!=authorization.feeAmount+authorization.netAmount||authorization.feeAmount!=expectedFee) revert InvalidWithdrawalAmounts();
        if(usdt.balanceOf(address(this))<authorization.netAmount) revert InsufficientWithdrawalLiquidity();
        processedWithdrawals[reservationHash]=true;
        withdrawalLiquidityPaid+=authorization.netAmount;
        usdt.safeTransfer(authorization.destination,authorization.netAmount);
        emit WithdrawalPaid(reservationHash,authorization.reservationId,authorization.user,authorization.destination,authorization.payoutType,authorization.earningSource,authorization.grossAmount,authorization.feeAmount,authorization.netAmount,authorization.nonce,msg.sender,authorizer);
    }

    function withdrawalAuthorizationHash(WithdrawalAuthorization calldata authorization) public view returns(bytes32) {
        bytes32 structHash=keccak256(abi.encode(
            WITHDRAWAL_AUTHORIZATION_TYPEHASH,
            authorization.payoutType,
            authorization.reservationId,
            authorization.earningSource,
            authorization.user,
            authorization.chainId,
            authorization.verifyingContract,
            authorization.grossAmount,
            authorization.feeAmount,
            authorization.netAmount,
            authorization.destination,
            authorization.issuedAt,
            authorization.nonce,
            authorization.deadline
        ));
        bytes32 domainSeparator=keccak256(abi.encode(
            _EIP712_DOMAIN_TYPEHASH,
            _EIP712_NAME_HASH,
            _EIP712_VERSION_HASH,
            block.chainid,
            address(this)
        ));
        return keccak256(abi.encodePacked(hex"1901",domainSeparator,structHash));
    }

    function paymentSourceKey(address user,bytes32 paymentType,uint256 amount,bytes32 sourceReference) external view returns(bytes32){
        return _paymentSourceKey(user,paymentType,amount,sourceReference);
    }

    function _paymentSourceKey(address user,bytes32 paymentType,uint256 amount,bytes32 sourceReference) private view returns(bytes32){
        return keccak256(abi.encode(block.chainid,address(this),user,paymentType,amount,sourceReference));
    }

    function setTreasuryWallet(address treasury) external onlyRole(DEFAULT_ADMIN_ROLE){if(treasury==address(0)||treasury==address(this))revert ZeroAddress();address previous=treasuryWallet;_revokeRole(TREASURY_ROLE,previous);treasuryWallet=treasury;_grantRole(TREASURY_ROLE,treasury);emit TreasuryWalletUpdated(previous,treasury,msg.sender);}
    function grantRole(bytes32 role,address account) public override {
        if((role==AUTHORIZER_ROLE&&hasRole(WITHDRAWAL_EXECUTOR_ROLE,account))||(role==WITHDRAWAL_EXECUTOR_ROLE&&hasRole(AUTHORIZER_ROLE,account))) revert RoleSeparationRequired();
        super.grantRole(role,account);
    }
    function setPaymentsPaused(bool value) external onlyRole(PAUSER_ROLE){paymentsPaused=value;emit PaymentPauseChanged(value);}
    function setWithdrawalsPaused(bool value) external onlyRole(PAUSER_ROLE){withdrawalsPaused=value;emit WithdrawalPauseChanged(value);}
    function setPlacementPaused(bool x3Value,bool x4Value) external onlyRole(PAUSER_ROLE){x3PlacementPaused=x3Value;x4PlacementPaused=x4Value;}

    function distributeBatch(address[] calldata sources, uint256 cycleId)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (sources.length == 0 || sources.length > 100) revert InvalidBatchSize();
        if (cycleId != block.timestamp / 1 days) revert InvalidCycle();

        for (uint256 i; i < sources.length; ++i) {
            _distribute(sources[i], cycleId);
        }
    }

    function _distribute(address source, uint256 cycleId) private {
        if (lastDistributedCycle[source] >= cycleId) revert AlreadyDistributed();
        if (magicBalance[source] < oneDollar) revert InsufficientMagicBalance();

        lastDistributedCycle[source] = cycleId;
        magicBalance[source] -= oneDollar;

        address upline = matrixParentOf[source];
        uint256 qualifiedAmount;
        uint256 pendingAmount;

        for (uint8 level = 1; level <= MAX_LEVELS; ++level) {
            if (upline == address(0)) {
                pendingNoUpline[source][level] += levelPayment;
                pendingAmount += levelPayment;
                emit MagicLevelAllocated(cycleId, source, address(0), level, levelPayment, false);
                continue;
            }

            bool qualified = directCount[upline] >= requiredDirects(level);
            uint256 allocatedAmount = levelPayment;
            if (qualified) {
                uint256 credit = _applyIncomeCap(
                    upline,
                    keccak256("MAGIC_LEVEL_INCOME"),
                    levelPayment
                );
                (, uint256 incomeCredit) = _splitEarning(upline, keccak256("MAGIC_LEVEL_INCOME"), credit);
                claimableMagicIncome[upline] += incomeCredit;
                qualifiedAmount += credit;
                allocatedAmount = credit;
            } else {
                pendingUnqualified[upline][level] += levelPayment;
                pendingAmount += levelPayment;
            }
            emit MagicLevelAllocated(cycleId, source, upline, level, allocatedAmount, qualified);
            upline = matrixParentOf[upline];
        }

        emit MagicDistributed(cycleId, source, oneDollar, qualifiedAmount, pendingAmount);
    }

    function requiredDirects(uint8 level) public pure returns (uint256) {
        if (level == 0 || level > MAX_LEVELS) return type(uint256).max;
        return (uint256(level) + 1) / 2;
    }

    function fundMagic(address user, uint256 amount, bytes32 sourceReference)
        external
        onlyRole(MAGIC_FUNDING_ROLE)
        nonReentrant
    {
        if (!registered[user] || user == address(0)) revert SponsorNotRegistered();
        if (amount == 0) revert UnexpectedTokenTransfer();
        if (sourceReference == bytes32(0)) revert InvalidSourceReference();
        if (processedMagicFunding[sourceReference]) revert FundingAlreadyProcessed();
        processedMagicFunding[sourceReference] = true;
        magicBalance[user] += amount;
        emit MagicFunded(user, sourceReference, amount);
    }

    function _splitEarning(address user, bytes32 incomeType, uint256 gross)
        private
        returns (uint256 magicAmount, uint256 incomeAmount)
    {
        magicAmount = gross / 10;
        incomeAmount = gross - magicAmount;
        if (magicAmount > 0) magicBalance[user] += magicAmount;
        emit EarningSplit(user, incomeType, gross, magicAmount, incomeAmount);
    }

    function getRemainingEarningCap(address user) public view returns (uint256) {
        uint256 cap = totalEarningCap[user];
        uint256 earned = totalEarned[user];
        return earned >= cap ? 0 : cap - earned;
    }

    function getCappingStatus(address user) external view returns (uint8) {
        uint256 cap = totalEarningCap[user];
        if (cap == 0 || totalEarned[user] >= cap) return 2;
        if (totalEarned[user] * 100 >= cap * 90) return 1;
        return 0;
    }

    function _applyIncomeCap(address user, bytes32 incomeType, uint256 calculated)
        private
        returns (uint256 credited)
    {
        uint256 remaining = getRemainingEarningCap(user);
        credited = calculated > remaining ? remaining : calculated;
        uint256 excess = calculated - credited;
        totalEarned[user] += credited;
        if (excess > 0) {
            cappedExcess[user][incomeType] += excess;
            emit IncomeCapped(user, incomeType, calculated, credited, excess);
        }
    }

    function currentCycle() external view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function matrixSize() external view returns (uint256) {
        return _registeredUsers.length;
    }

    function matrixUserAt(uint256 index) external view returns (address) {
        return _registeredUsers[index];
    }

    function getMatrixChildren(address node)
        external
        view
        returns (address left, address right)
    {
        address[2] storage children = _matrixChildren[node];
        return (children[0], children[1]);
    }

    function getMatrixChildCount(address node)
        external
        view
        returns (uint8)
    {
        return _matrixChildCount[node];
    }

    function getPlacementQueueState(address sponsor)
        external
        view
        returns (uint256 head, uint256 size)
    {
        return (_placementQueueHead[sponsor], _placementQueue[sponsor].length);
    }

    function advancePlacementCursor(address sponsor, uint256 maxSteps)
        external
        returns (bool availablePositionFound)
    {
        if (!registered[sponsor]) revert SponsorNotRegistered();
        if (maxSteps == 0 || maxSteps > MAX_CURSOR_ADVANCE_STEPS) {
            revert InvalidAdvanceSteps();
        }
        uint256 previousHead = _placementQueueHead[sponsor];
        availablePositionFound = _advancePastFullNodes(sponsor, maxSteps);
        emit PlacementCursorAdvanced(
            sponsor,
            previousHead,
            _placementQueueHead[sponsor],
            availablePositionFound
        );
    }

    function _findPlacement(address sponsor, uint256 maxSteps)
        private
        returns (address parent, uint8 position)
    {
        bool found = _advancePastFullNodes(sponsor, maxSteps);
        if (!found) {
            revert PlacementSearchNeedsAdvance(
                sponsor,
                _placementQueueHead[sponsor]
            );
        }
        parent = _placementQueue[sponsor][_placementQueueHead[sponsor]];
        position = _matrixChildren[parent][0] == address(0) ? 0 : 1;
    }

    function _advancePastFullNodes(address sponsor, uint256 maxSteps)
        private
        returns (bool availablePositionFound)
    {
        address[] storage queue = _placementQueue[sponsor];
        if (queue.length == 0) queue.push(sponsor);
        uint256 head = _placementQueueHead[sponsor];
        for (uint256 steps; steps < maxSteps; ++steps) {
            address candidate = queue[head];
            if (_matrixChildCount[candidate] < 2) {
                _placementQueueHead[sponsor] = head;
                return true;
            }
            address[2] storage children = _matrixChildren[candidate];
            queue.push(children[0]);
            queue.push(children[1]);
            unchecked { ++head; }
        }
        _placementQueueHead[sponsor] = head;
        return false;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
