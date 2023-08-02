import { Address, log, BigInt, ethereum, Bytes, BigDecimal } from "@graphprotocol/graph-ts"
import {
  StrategyAdded,
  StrategyReported,
  ReaperVaultERC4626,
  Deposit,
  Withdraw
} from "../generated/ReaperVaultERC4626/ReaperVaultERC4626"
import {
  ReaperBaseStrategy as StrategyContract
} from "../generated/templates/ReaperVaultERC4626/ReaperBaseStrategy"
import { Vault, Strategy, StrategyReport, StrategyReportResult, User } from "../generated/schema"

const BIGINT_ZERO = BigInt.fromI32(0);
const BIGDECIMAL_ZERO = new BigDecimal(BIGINT_ZERO);
const MS_PER_DAY = new BigDecimal(BigInt.fromI32(24 * 60 * 60 * 1000));
const DAYS_PER_YEAR = new BigDecimal(BigInt.fromI32(365));
const BPS_UNIT = BigInt.fromI32(10000);

export function handleStrategyAdded(event: StrategyAdded): void {
  const strategyAddress = event.params.strategy;
  const strategyId = strategyAddress.toHexString();
  let strategyContract = StrategyContract.bind(strategyAddress);
  let vaultAddress = strategyContract.vault();
  log.info('handleStrategyAdded strategy {} in vault {}', [
    strategyId,
    vaultAddress.toHexString()
  ]);
  getOrCreateVault(vaultAddress);
  const strategy = new Strategy(strategyId);
  strategy.vault = vaultAddress.toHexString();
  strategy.save();
}

export function handleStrategyReported(event: StrategyReported): void {

  log.info('handleStrategyReported called', []);

  const params = event.params;
  const strategyId = params.strategy.toHexString();
  const gain = params.gain;
  const loss = params.loss;
  const debtPaid = params.debtPaid;
  const gains = params.gains;
  const losses = params.losses;
  const allocated = params.allocated;
  const allocationAdded = params.allocationAdded;
  const allocBPS = params.allocBPS;

  log.info('handleStrategyReported strategy {} gain {} loss {} debtPaid {} gains {} losses {} allocated {} allocationAdded {} allocBPS {}', [
    strategyId,
    gain.toString(),
    loss.toString(),
    debtPaid.toString(),
    gains.toString(),
    losses.toString(),
    allocated.toString(),
    allocationAdded.toString(),
    allocBPS.toString()
  ]);

  const strategy = Strategy.load(strategyId);
  if (strategy !== null) {
    let currentReportId = strategy.latestReport;
    log.info(
      '[Strategy] Getting current report {} for strategy {}.',
      [currentReportId ? currentReportId : 'null', strategy.id]
    );
    let strategyReportId = buildIdFromEvent(event);
    let strategyReport = StrategyReport.load(strategyReportId);
    if (strategyReport === null) {
        log.info(
          'strategyReport === null',
          []
        );
        strategyReport = new StrategyReport(strategyReportId);
        strategyReport.gain = gain;
        strategyReport.loss = loss;
        strategyReport.debtPaid = debtPaid;
        strategyReport.strategy = strategy.id;
        strategyReport.timestamp = getTimestampInMillis(event.block);
        strategyReport.gains = gains;
        strategyReport.losses = losses;
        strategyReport.allocated = allocated;
        strategyReport.allocationAdded = allocationAdded;
        strategyReport.allocBPS = allocBPS;
        strategyReport.save();
    }
    strategy.latestReport = strategyReport.id;
    strategy.save();
    // Getting latest report to compare to the new one and create a new report result.
    if (currentReportId !== null) {
      let currentReport = StrategyReport.load(currentReportId);
      if (currentReport !== null) {
        log.info(
          '[Strategy] Create report result (latest {} vs current {}) for strategy {}.',
          [strategyReport.id, currentReport.id, strategyId]
        );
        const reportResult = createStrategyReportResult(currentReport, strategyReport, strategy.vault, event);
        strategyReport.results = reportResult.id;
        strategyReport.save();
        updateVaultAPR(strategy.vault);
      }
    } else {
      log.info(
        '[Strategy] Report result NOT created. Only one report created {} for strategy {}.',
        [strategyReport.id, strategyId]
      );
    }
  } else {
    log.warning(
      '[Strategy] Failed to load strategy {} while handling StrategyReport',
      [strategyId]
    );
  }
}

function getOrCreateVault(vaultAddress: Address): Vault {
  let id = vaultAddress.toHexString();
  log.info('getOrCreateVault {}', [id]);
  let vaultEntity = Vault.load(id);
  if (vaultEntity == null) {
    vaultEntity = new Vault(id);
    vaultEntity.nrOfStrategies = BigInt.fromI32(1);
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
    '[StrategyReportResult] Create strategy report result between previous {} and current report {}. Strategy {}',
    [previousReport.id, currentReport.id, currentReport.strategy]
  );

  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;

  let id = buildIdFromEvent(event);
  let strategyReportResult = new StrategyReportResult(id);
  strategyReportResult.timestamp = timestamp;
  strategyReportResult.blockNumber = blockNumber;
  strategyReportResult.currentReport = currentReport.id;
  strategyReportResult.previousReport = previousReport.id;
  strategyReportResult.startTimestamp = previousReport.timestamp;
  strategyReportResult.endTimestamp = currentReport.timestamp;
  strategyReportResult.duration = currentReport.timestamp
    .toBigDecimal()
    .minus(previousReport.timestamp.toBigDecimal());
  strategyReportResult.durationPr = BIGDECIMAL_ZERO;
  strategyReportResult.apr = BIGDECIMAL_ZERO;
  strategyReportResult.vaultAPR = BIGDECIMAL_ZERO;
  strategyReportResult.vault = vaultAddress;
  strategyReportResult.pricePerFullShare = BIGINT_ZERO;
  //change this to accurately reflect changes in loss in well
  const profit = currentReport.gains.minus(previousReport.gains);
  const loss = currentReport.losses.minus(previousReport.losses);
  const pnl = profit.minus(loss);
  const msInDays = strategyReportResult.duration.div(MS_PER_DAY);
  log.info(
    '[StrategyReportResult] Report Result - Start / End: {} / {} - Duration: {} (days {}) - Profit: {}',
    [
      strategyReportResult.startTimestamp.toString(),
      strategyReportResult.endTimestamp.toString(),
      strategyReportResult.duration.toString(),
      msInDays.toString(),
      pnl.toString()
    ]
  );

  if (!previousReport.allocated.isZero() && !msInDays.equals(BIGDECIMAL_ZERO)) {
    let profitOverTotalDebt = pnl
      .toBigDecimal()
      .div(previousReport.allocated.toBigDecimal());
    strategyReportResult.durationPr = profitOverTotalDebt;
    let yearOverDuration = DAYS_PER_YEAR.div(msInDays);
    let apr = profitOverTotalDebt.times(yearOverDuration);

    log.info(
      '[StrategyReportResult] Report Result - Duration: {} ms / {} days - Duration (Year): {} - Profit / Total Debt: {} / APR: {}',
      [
        strategyReportResult.duration.toString(),
        msInDays.toString(),
        yearOverDuration.toString(),
        profitOverTotalDebt.toString(),
        apr.toString(),
      ]
    );
    strategyReportResult.apr = apr;
    let vaultContract = ReaperVaultERC4626.bind(Address.fromString(vaultAddress));
    strategyReportResult.pricePerFullShare = vaultContract.getPricePerFullShare();
  }
  strategyReportResult.save();
  return strategyReportResult;
}

export function updateVaultAPR(vaultAddress: string): void {
  log.info('updateVaultAPR - vaultAddress: {}', [vaultAddress]);
  let vaultContract = ReaperVaultERC4626.bind(Address.fromString(vaultAddress));
  let vaultEntity = Vault.load(vaultAddress);
  if (vaultEntity) {
    const nrOfStrategies = vaultEntity.nrOfStrategies.toI32();
    log.info('updateVaultAPR - nrOfStrategies: {}', [nrOfStrategies.toString()]);
    let vaultAPR = new BigDecimal(BIGINT_ZERO);
    for (let index = 0; index < nrOfStrategies; index++) {
      log.info('updateVaultAPR - entered for loop', []);
      const strategyAddress = vaultContract.withdrawalQueue(BigInt.fromI32(index));
      log.info('updateVaultAPR - strategyAddress.toHexString(): {}', [strategyAddress.toHexString()]);
      const strategy = Strategy.load(strategyAddress.toHexString());
      
      if (strategy) {
        log.info('updateVaultAPR - strategy is defined', []);
        const strategyParams = vaultContract.strategies(strategyAddress);
        const allocation = strategyParams.getAllocBPS();
        log.info('updateVaultAPR - allocation: {}', [allocation.toString()]);
        const reportId = strategy.latestReport;
        if (reportId) {
          log.info('updateVaultAPR - reportId: {}', [reportId as string]);
          const report = StrategyReport.load(reportId);
          if (report) {
            log.info('updateVaultAPR - report is defined', []);
            const reportResultsId = report.results;
            if (reportResultsId) {
              log.info('updateVaultAPR - reportResultsId: {}', [reportResultsId]);
              const reportResult = StrategyReportResult.load(reportResultsId);
              if (reportResult) {
                log.info('updateVaultAPR - reportResult is defined', []);
                const strategyAPRContribution = reportResult.apr.times(new BigDecimal(allocation)).div(new BigDecimal(BPS_UNIT));
                log.info('updateVaultAPR - strategyAPRContribution: {}', [strategyAPRContribution.toString()]);
                vaultAPR = vaultAPR.plus(strategyAPRContribution);
                reportResult.vaultAPR = vaultAPR;
                reportResult.save();
              }
            }
          }
        }
      }
      const vault = Vault.load(vaultAddress);
      if (vault) {
        log.info('updateVaultAPR - vault is defined', []);
        vault.apr = vaultAPR;
        vault.save();
        log.info('updateVaultAPR - vault saved', []);
      }
    }
  }
}

export function handleDeposit (event:Deposit):void {
  log.info('handleDeposit called', []);
  const user = getOrCreateUser(event.params.sender, event.address);
  if (user) {
    log.info('handleDeposit called - user {}, amount {}', [user.id, event.params.assets.toString()]);
    user.totalDeposits = user.totalDeposits.plus(event.params.assets);
    user.save();
  }
}

export function handleWithdrawal (event:Withdraw):void {
  log.info('handleWithdrawal called', []);
  const user = getOrCreateUser(event.params.sender, event.address);
  if (user) {
    log.info('handleWithdrawal called - user {}, amount {}', [user.id, event.params.assets.toString()]);
    user.totalWithdrawals = user.totalWithdrawals.plus(event.params.assets);
    user.save();
  }
}

function getOrCreateUser(walletAddress: Address, vaultAddress:Address): User {
  let id = `${walletAddress.toHexString()}-${vaultAddress.toHexString()}`;
  log.info('getOrCreateUser {}', [id]);
  let userEntity = User.load(id);
  if (userEntity == null) {
    userEntity = new User(id);
    userEntity.totalDeposits = BIGINT_ZERO;
    userEntity.totalWithdrawals = BIGINT_ZERO;
    userEntity.save();
  }
  return userEntity;
}

// make a derived ID from transaction hash and big number
export function buildId(tx: Bytes, n: BigInt): string {
  return tx.toHexString().concat('-').concat(n.toString());
}

export function buildIdFromEvent(event: ethereum.Event): string {
  return buildId(event.transaction.hash, event.logIndex);
}

export function getTimestampInMillis(block: ethereum.Block): BigInt {
  return block.timestamp.times(BigInt.fromI32(1000));
}