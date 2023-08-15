import { Address, log, BigInt, ethereum, Bytes } from "@graphprotocol/graph-ts";
import {
  StrategyAdded,
  StrategyReported,
  ReaperVaultERC4626,
  Deposit,
  Withdraw,
} from "../generated/ReaperVaultERC4626/ReaperVaultERC4626";
import {
  ReaperBaseStrategy as StrategyContract,
} from "../generated/templates/ReaperVaultERC4626/ReaperBaseStrategy";
import {
  Vault, Strategy, StrategyReport, StrategyReportResult, User, VaultAPRReport,
} from "../generated/schema";

const ZERO = BigInt.zero();
const BIGINT_SEC_PER_DAY = BigInt.fromI32(24 * 60 * 60);
const BIGINT_SEC_PER_YEAR = BigInt.fromI32(24 * 60 * 60 * 365);
const BPS_UNIT = BigInt.fromI32(10000);

export function handleStrategyAdded(event: StrategyAdded): void {
  const strategyAddress = event.params.strategy;
  const strategyId = strategyAddress.toHexString();
  const strategyContract = StrategyContract.bind(strategyAddress);
  const vaultAddress = strategyContract.vault();
  log.info("handleStrategyAdded strategy {} in vault {}", [
    strategyId,
    vaultAddress.toHexString(),
  ]);
  getOrCreateVault(vaultAddress, event.block.timestamp);
  const strategy = new Strategy(strategyId);
  strategy.vault = vaultAddress.toHexString();
  strategy.save();
}

export function handleStrategyReported(event: StrategyReported): void {
  log.info("handleStrategyReported called", []);

  const params = event.params;
  const strategyId = params.strategy.toHexString();
  const strategy = Strategy.load(strategyId);
  if (strategy == null) {
    log.warning(
      "[Strategy] Failed to load strategy {} while handling StrategyReport",
      [strategyId]
    );
    return;
  }

  const gain = params.gain;
  const loss = params.loss;
  const debtPaid = params.debtPaid;
  const gains = params.gains;
  const losses = params.losses;
  const allocated = params.allocated;
  const allocationAdded = params.allocationAdded;
  const allocBPS = params.allocBPS;

  log.info("handleStrategyReported strategy {} gain {} loss {} debtPaid {} gains {} losses {} allocated {} allocationAdded {} allocBPS {}", [
    strategyId,
    gain.toString(),
    loss.toString(),
    debtPaid.toString(),
    gains.toString(),
    losses.toString(),
    allocated.toString(),
    allocationAdded.toString(),
    allocBPS.toString(),
  ]);

  const lastReportId = strategy.latestReport;
  log.info(
    "[Strategy] Getting last report {} for strategy {}.",
    [lastReportId ? lastReportId : "null", strategy.id]
  );

  const strategyReportId = buildIdFromEvent(event);
  const strategyReport = new StrategyReport(strategyReportId);
  strategyReport.gain = gain;
  strategyReport.loss = loss;
  strategyReport.debtPaid = debtPaid;
  strategyReport.strategy = strategy.id;
  strategyReport.timestamp = getTimestampFromBlock(event.block);
  strategyReport.gains = gains;
  strategyReport.losses = losses;
  strategyReport.allocated = allocated;
  strategyReport.allocationAdded = allocationAdded;
  strategyReport.allocBPS = allocBPS;
  strategyReport.save();

  strategy.latestReport = strategyReport.id;
  strategy.save();

  // Getting last report to compare to the new one and create a new report result.
  if (lastReportId !== null) {
    const lastReport = StrategyReport.load(lastReportId);
    if (lastReport !== null) {
      log.info(
        "[Strategy] Create report result (new {} vs last {}) for strategy {}.",
        [strategyReport.id, lastReport.id, strategyId]
      );

      const reportResult =
        createStrategyReportResult(lastReport, strategyReport, strategy.vault, event);
      strategyReport.results = reportResult.id;
      strategyReport.save();
      updateVaultAPR(strategy.vault, getTimestampFromBlock(event.block));
    }
  } else {
    log.info(
      "[Strategy] Report result NOT created. Only one report created {} for strategy {}.",
      [strategyReport.id, strategyId]
    );
  }
}

function getOrCreateVault(vaultAddress: Address, timestamp: BigInt): Vault {
  const id = vaultAddress.toHexString();
  log.info("getOrCreateVault {}", [id]);
  let vaultEntity = Vault.load(id);
  if (vaultEntity == null) {
    vaultEntity = new Vault(id);
    vaultEntity.nrOfStrategies = BigInt.fromI32(1);
    vaultEntity.lastUpdated = timestamp;

    const vaultContract = ReaperVaultERC4626.bind(
      Address.fromString(vaultAddress.toHexString())
    );
    const ppFullShare = vaultContract.getPricePerFullShare();
    vaultEntity.pricePerFullShare = ppFullShare;
  } else {
    vaultEntity.nrOfStrategies = vaultEntity.nrOfStrategies.plus(BigInt.fromI32(1));
  }

  vaultEntity.save();
  return vaultEntity;
}

export function createStrategyReportResult(
  previousReport: StrategyReport,
  currentReport: StrategyReport,
  vaultAddress: string,
  event: StrategyReported
): StrategyReportResult {
  log.info(
    "[StrategyReportResult] Create strategy report result between previous {} and current report {}. Strategy {}",
    [previousReport.id, currentReport.id, currentReport.strategy]
  );

  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;

  const id = buildIdFromEvent(event);
  const strategyReportResult = new StrategyReportResult(id);
  strategyReportResult.timestamp = timestamp;
  strategyReportResult.blockNumber = blockNumber;
  strategyReportResult.currentReport = currentReport.id;
  strategyReportResult.previousReport = previousReport.id;
  strategyReportResult.startTimestamp = previousReport.timestamp;
  strategyReportResult.endTimestamp = currentReport.timestamp;
  strategyReportResult.duration = currentReport.timestamp.minus(previousReport.timestamp);
  strategyReportResult.apr = ZERO;
  strategyReportResult.vault = vaultAddress;

  const profit = currentReport.gain;
  const loss = currentReport.loss;
  const pnl = profit.minus(loss);
  log.info(
    "[StrategyReportResult] Report Result - Start / End: {} / {} - Duration: {} - Profit: {}",
    [
      strategyReportResult.startTimestamp.toString(),
      strategyReportResult.endTimestamp.toString(),
      strategyReportResult.duration.toString(),
      pnl.toString(),
    ]
  );

  if (
    previousReport.allocated.gt(ZERO) &&
    strategyReportResult.duration.gt(ZERO)
  ) {
    // duration -> pnl
    // => 1s -> (pnl/duration)
    // => one year -> (pnl/duration) * (one year)
    // => apr = (pnl/duration) * (one year) / principal * unit multiplier
    // to divide last,
    // numerator = pnl * one year * unit multiplier
    // denominator = duration * principal
    const numerator = pnl.times(BIGINT_SEC_PER_YEAR).times(BPS_UNIT);
    const denomintator = previousReport.allocated.times(strategyReportResult.duration);
    const apr = numerator.div(denomintator);

    log.info(
      "[StrategyReportResult] Report Result - Duration: {} sec - APR: {}",
      [
        strategyReportResult.duration.toString(),
        apr.toString(),
      ]
    );
    strategyReportResult.apr = apr;
  }

  strategyReportResult.save();
  return strategyReportResult;
}

export function updateVaultAPR(vaultAddress: string, timestamp: BigInt): void {
  log.info("updateVaultAPR - vaultAddress: {}", [vaultAddress]);
  const vaultContract = ReaperVaultERC4626.bind(Address.fromString(vaultAddress));
  const vaultEntity = Vault.load(vaultAddress);
  if (vaultEntity) {
    const aprLastUpdated = vaultEntity.lastUpdated;
    if (checkIfTimePastXSeconds(aprLastUpdated, timestamp, BIGINT_SEC_PER_DAY)) {
      const previousPPFullShare = vaultEntity.pricePerFullShare;
      const currentPPFullShare = vaultContract.getPricePerFullShare();
      const apr = calculateAPRUsingPPFullShare(
        previousPPFullShare,
        currentPPFullShare,
        aprLastUpdated,
        timestamp,
      );

      vaultEntity.apr = apr;
      vaultEntity.pricePerFullShare = currentPPFullShare;
      vaultEntity.lastUpdated = timestamp;
      createVaultAPRReport(vaultAddress, apr, currentPPFullShare, timestamp);
      vaultEntity.save();
    }
  }
}

export function handleDeposit(event: Deposit): void {
  log.info("handleDeposit called", []);
  const user = getOrCreateUser(event.params.sender, event.address);
  if (user) {
    log.info("handleDeposit called - user {}, amount {}", [user.id, event.params.assets.toString()]);
    user.totalDeposits = user.totalDeposits.plus(event.params.assets);
    user.save();
  }
}

export function handleWithdrawal(event: Withdraw): void {
  log.info("handleWithdrawal called", []);
  const user = getOrCreateUser(event.params.sender, event.address);
  if (user) {
    log.info("handleWithdrawal called - user {}, amount {}", [user.id, event.params.assets.toString()]);
    user.totalWithdrawals = user.totalWithdrawals.plus(event.params.assets);
    user.save();
  }
}

function getOrCreateUser(walletAddress: Address, vaultAddress: Address): User {
  const id = `${walletAddress.toHexString()}-${vaultAddress.toHexString()}`;
  log.info("getOrCreateUser {}", [id]);
  let userEntity = User.load(id);
  if (userEntity == null) {
    userEntity = new User(id);
    userEntity.totalDeposits = ZERO;
    userEntity.totalWithdrawals = ZERO;
    userEntity.save();
  }
  return userEntity;
}

// make a derived ID from transaction hash and big number
export function buildId(tx: Bytes, n: BigInt): string {
  return tx.toHexString().concat("-").concat(n.toString());
}

export function buildIdFromEvent(event: ethereum.Event): string {
  return buildId(event.transaction.hash, event.logIndex);
}

export function getTimestampFromBlock(block: ethereum.Block): BigInt {
  return block.timestamp;
}

function checkIfTimePastXSeconds(
  startTimestamp: BigInt,
  endTimestamp: BigInt,
  milestone: BigInt
): boolean {
  const duration = endTimestamp.minus(startTimestamp);
  log.info("Duration = {} : MILESTONE = {}", [duration.toString(), milestone.toString()]);
  if (duration.gt(milestone)) {
    return true;
  } else {
    return false;
  }
}

function calculateAPRUsingPPFullShare(
  previousPPFullShare: BigInt,
  currentPPFullShare: BigInt,
  previousTimestamp: BigInt,
  currentTimestamp: BigInt
): BigInt {
  // numerator = pnl * one year * unit multiplier
  // denominator = duration * principal
  const sharePriceChange = currentPPFullShare.minus(previousPPFullShare);
  const duration = currentTimestamp.minus(previousTimestamp);
  const numerator = sharePriceChange.times(BIGINT_SEC_PER_YEAR).times(BPS_UNIT);
  const denominator = previousPPFullShare.times(duration);
  const apr = numerator.div(denominator);

  return apr;
}

function createVaultAPRReport(
  vaultAddress: string,
  apr: BigInt,
  pricePerFullShare: BigInt,
  timestamp: BigInt
): void {
  const id = `${vaultAddress}-${timestamp}`;
  const vaultAPRReport = new VaultAPRReport(id);
  vaultAPRReport.vault = vaultAddress;
  vaultAPRReport.apr = apr;
  vaultAPRReport.pricePerFullShare = pricePerFullShare;
  vaultAPRReport.timestamp = timestamp;
  vaultAPRReport.save();
  return;
}
