// 税务风险扫描引擎（Task7 税务风险监控核心）
//
// 职责：
// 1. scanSubject：对某主体逐个指标调用对应检测函数，命中则创建/更新 RiskEvent（去重）
// 2. 9 个检测函数（detectXxx），每个返回 { hit, level, metricValue, description, suggestion } | null
// 3. triggerScan：被外部调用（凭证过账、数据导入后），异步触发扫描，不阻塞调用方（满足 5 秒内扫描要求）
// 4. rescanAll：按当前阈值重新扫描，更新已存在事件或关闭不再命中事件
// 5. onVoucherPosted / onDataImported：供凭证服务/导入服务调用的钩子
//
// 等级判定优先级：HIGH > MEDIUM > LOW
// 高风险事件通过 AuditLog（action=RISK_ALERT_HIGH）推送管理员，避免新增模型
//
// 数据来源：发票（Invoice）、银行流水（BankTransaction）、已过账凭证分录（VoucherEntry+Account）
// 为避免与 voucherService 形成循环依赖，本期损益聚合在本服务内直接用 prisma 计算

import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import auditRepo from '../repositories/auditRepo';

// ============ 常量 ============

// 计入余额的凭证状态：POSTED 与 RED_VOID（红冲已自动过账）
const POSTED_STATUSES = ['POSTED', 'RED_VOID'];
// 风险事件活跃状态（去重时认为未关闭）
const ACTIVE_EVENT_STATUSES = ['PENDING', 'IN_PROGRESS'];

// ============ 类型 ============

// 单个指标检测返回结果
interface DetectResult {
  hit: boolean;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  metricValue: string; // 命中指标的实际值
  thresholdValue?: string; // 命中的阈值
  description: string;
  suggestion?: string;
}

// 扫描结果摘要
export interface ScanSummary {
  subjectId: number;
  period: string | null;
  scanned: number; // 扫描指标数
  hit: number; // 命中数
  events: Array<{ id: number; indicatorCode: string; level: string; status: string }>;
}

// ============ 通用辅助 ============

// 左补零到两位
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// 某所属期 YYYY-MM 的起止时间
function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return { start, end };
}

// 上一期 YYYY-MM
function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${pad2(m - 1)}`;
}

// 解析阈值 JSON
function parseThreshold(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// 从阈值对象提取数值条件，判断实际值是否命中
// 支持 {lt: n}（实际值 < n 命中）、{gt: n}（实际值 > n 命中）
// 也支持领域专用键名：xxxGt 表示 > n 命中（如 costRatioGt/diffGt/creditRatioGt），xxxLt 表示 < n 命中
function matchNumericThreshold(threshold: Record<string, unknown>, value: number): boolean {
  if (threshold.lt !== undefined) return value < Number(threshold.lt);
  if (threshold.gt !== undefined) return value > Number(threshold.gt);
  // 兼容 creditRatioGt / costRatioGt / diffGt 等领域键名
  for (const key of Object.keys(threshold)) {
    if (key.endsWith('Gt') && threshold[key] !== undefined) return value > Number(threshold[key]);
    if (key.endsWith('Lt') && threshold[key] !== undefined) return value < Number(threshold[key]);
  }
  return false;
}

// 解析所属期（YYYY-MM）。若未提供，则取该主体最新发票/凭证所在月份，兜底当前月
async function resolvePeriod(subjectId: number, period?: string | null): Promise<string> {
  if (period && /^\d{4}-\d{2}$/.test(period)) return period;
  // 取最新发票开票月份
  const latestInvoice = await prisma.invoice.findFirst({
    where: { subjectId },
    orderBy: { billingDate: 'desc' },
    select: { billingDate: true },
  });
  if (latestInvoice) {
    const d = latestInvoice.billingDate;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  // 兜底当前月
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

// 聚合某主体某期内发票税额/不含税金额（按进销项、排除 VOID）
async function aggregateInvoices(
  subjectId: number,
  start: Date,
  end: Date
): Promise<{
  inputTax: number;
  outputTax: number;
  inputAmount: number; // 进项不含税
  outputAmount: number; // 销项不含税
  voidCount: number;
  totalCount: number;
  topAmountCount: number; // 顶额开票数（金额=99999.99）
  consecutiveCount: number; // 连号发票组数
}> {
  const invoices = await prisma.invoice.findMany({
    where: { subjectId, billingDate: { gte: start, lte: end } },
    orderBy: { invoiceNo: 'asc' },
  });
  let inputTax = 0;
  let outputTax = 0;
  let inputAmount = 0;
  let outputAmount = 0;
  let voidCount = 0;
  let topAmountCount = 0;
  for (const inv of invoices) {
    const tax = Number(inv.taxAmount.toString());
    const amt = Number(inv.amountExclTax.toString());
    if (inv.direction === 'INPUT') {
      inputTax += tax;
      inputAmount += amt;
    } else {
      outputTax += tax;
      outputAmount += amt;
    }
    if (inv.status === 'VOID') voidCount++;
    // 顶额开票：不含税金额接近 99999.99（允许 0.01 误差）
    if (Math.abs(amt - 99999.99) < 0.01) topAmountCount++;
  }
  // 连号检测：发票号码相邻（数字差1）且方向相同的组数
  let consecutiveCount = 0;
  for (let i = 1; i < invoices.length; i++) {
    const prevNo = parseInt(invoices[i - 1].invoiceNo, 10);
    const curNo = parseInt(invoices[i].invoiceNo, 10);
    if (
      !Number.isNaN(prevNo) &&
      !Number.isNaN(curNo) &&
      curNo - prevNo === 1 &&
      invoices[i - 1].direction === invoices[i].direction
    ) {
      consecutiveCount++;
    }
  }
  return {
    inputTax,
    outputTax,
    inputAmount,
    outputAmount,
    voidCount,
    totalCount: invoices.length,
    topAmountCount,
    consecutiveCount,
  };
}

// 聚合某主体某期内损益类科目发生额（基于已过账凭证分录）
// 收入 = INCOME 类科目贷方-借方；成本费用 = EXPENSE 类科目借方-贷方
async function aggregatePnl(
  subjectId: number,
  start: Date,
  end: Date
): Promise<{ revenue: number; expense: number; inventoryChange: number }> {
  const entries = await prisma.voucherEntry.findMany({
    where: {
      voucher: {
        subjectId,
        status: { in: POSTED_STATUSES },
        voucherDate: { gte: start, lte: end },
      },
      account: { category: { in: ['INCOME', 'EXPENSE', 'ASSET'] } },
    },
    select: {
      debit: true,
      credit: true,
      account: { select: { code: true, name: true, category: true } },
    },
  });
  let revenue = 0;
  let expense = 0;
  let inventoryChange = 0; // 库存商品(1405)本期借方-贷方
  for (const e of entries) {
    const debit = Number(e.debit.toString());
    const credit = Number(e.credit.toString());
    if (e.account.category === 'INCOME') {
      revenue += credit - debit;
    } else if (e.account.category === 'EXPENSE') {
      expense += debit - credit;
    } else if (e.account.category === 'ASSET' && e.account.code === '1405') {
      inventoryChange += debit - credit;
    }
  }
  return { revenue, expense, inventoryChange };
}

// ============ 9 个指标检测函数 ============

// 1. 增值税税负率异常：税负率 = 应纳增值税 / 应税销售额
// 应纳增值税 = max(0, 销项税额 - 进项税额)；应税销售额 = 销项不含税金额
async function detectVatTaxBurden(
  subjectId: number,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  thresholdLow?: string | null
): Promise<DetectResult | null> {
  const { outputTax, inputTax, outputAmount } = await aggregateInvoices(subjectId, start, end);
  if (outputAmount <= 0) return null; // 无销售额无法计算
  const payableVat = Math.max(0, outputTax - inputTax);
  const burden = payableVat / outputAmount;
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  const tLow = parseThreshold(thresholdLow);
  let level: DetectResult['level'] | null = null;
  let thresholdValue: string | undefined;
  if (tHigh && matchNumericThreshold(tHigh, burden)) {
    level = 'HIGH';
    thresholdValue = thresholdHigh;
  } else if (tMed && matchNumericThreshold(tMed, burden)) {
    level = 'MEDIUM';
    thresholdValue = thresholdMedium;
  } else if (tLow && matchNumericThreshold(tLow, burden)) {
    level = 'LOW';
    thresholdValue = thresholdLow ?? undefined;
  }
  if (!level) return null;
  return {
    hit: true,
    level,
    metricValue: burden.toFixed(4),
    thresholdValue,
    description: `增值税税负率 ${burden.toFixed(4)}（销项税额 ${outputTax.toFixed(2)} - 进项税额 ${inputTax.toFixed(2)}）/ 销售额 ${outputAmount.toFixed(2)}，低于预警线`,
    suggestion: '检查进项抵扣是否异常增多、是否存在隐瞒销售收入或虚增进项发票的情况。',
  };
}

// 2. 进销项比对异常：进项税额环比增长
async function detectInputOutputMismatch(
  subjectId: number,
  period: string,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  thresholdLow?: string | null
): Promise<DetectResult | null> {
  const cur = await aggregateInvoices(subjectId, start, end);
  if (cur.inputTax <= 0) return null;
  // 上一期进项
  const prevPeriod = previousPeriod(period);
  const { start: ps, end: pe } = periodBounds(prevPeriod);
  const prev = await aggregateInvoices(subjectId, ps, pe);
  let growth: number;
  if (prev.inputTax <= 0) {
    // 上期为0本期有进项，视为100%增长
    growth = 1;
  } else {
    growth = (cur.inputTax - prev.inputTax) / prev.inputTax;
  }
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  const tLow = parseThreshold(thresholdLow);
  const highVal = tHigh ? Number(tHigh.inputGrowthGt ?? tHigh.gt ?? NaN) : NaN;
  const medVal = tMed ? Number(tMed.inputGrowthGt ?? tMed.gt ?? NaN) : NaN;
  let level: DetectResult['level'] | null = null;
  let thresholdValue: string | undefined;
  if (!Number.isNaN(highVal) && growth > highVal) {
    level = 'HIGH';
    thresholdValue = thresholdHigh;
  } else if (!Number.isNaN(medVal) && growth > medVal) {
    level = 'MEDIUM';
    thresholdValue = thresholdMedium;
  } else if (tLow) {
    const lowVal = Number(tLow.inputGrowthGt ?? tLow.gt ?? NaN);
    if (!Number.isNaN(lowVal) && growth > lowVal) {
      level = 'LOW';
      thresholdValue = thresholdLow ?? undefined;
    }
  }
  if (!level) return null;
  return {
    hit: true,
    level,
    metricValue: growth.toFixed(4),
    thresholdValue,
    description: `进项税额环比增长 ${(growth * 100).toFixed(1)}%（上期 ${prev.inputTax.toFixed(2)} → 本期 ${cur.inputTax.toFixed(2)}），增幅异常`,
    suggestion: '核查本期大额进项发票的真实性，确认是否为真实采购业务，防范虚抵进项风险。',
  };
}

// 3. 收入成本匹配异常：成本率 = 成本费用 / 收入
async function detectRevenueCostMismatch(
  subjectId: number,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  thresholdLow?: string | null
): Promise<DetectResult | null> {
  const { revenue, expense } = await aggregatePnl(subjectId, start, end);
  if (revenue <= 0) return null;
  const costRatio = expense / revenue;
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  const tLow = parseThreshold(thresholdLow);
  let level: DetectResult['level'] | null = null;
  let thresholdValue: string | undefined;
  if (tHigh && matchNumericThreshold(tHigh, costRatio)) {
    level = 'HIGH';
    thresholdValue = thresholdHigh;
  } else if (tMed && matchNumericThreshold(tMed, costRatio)) {
    level = 'MEDIUM';
    thresholdValue = thresholdMedium;
  } else if (tLow && matchNumericThreshold(tLow, costRatio)) {
    level = 'LOW';
    thresholdValue = thresholdLow ?? undefined;
  }
  if (!level) return null;
  return {
    hit: true,
    level,
    metricValue: costRatio.toFixed(4),
    thresholdValue,
    description: `成本率 ${costRatio.toFixed(4)}（成本费用 ${expense.toFixed(2)} / 收入 ${revenue.toFixed(2)}），偏离正常区间`,
    suggestion: '核查是否存在虚增成本、少计收入或成本结转不及时的情况。',
  };
}

// 4. 发票异常：作废率 / 顶额开票 / 连号
async function detectInvoiceAbnormal(
  subjectId: number,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  thresholdLow?: string | null
): Promise<DetectResult | null> {
  const agg = await aggregateInvoices(subjectId, start, end);
  if (agg.totalCount === 0) return null;
  const voidRate = agg.voidCount / agg.totalCount;
  const topRate = agg.topAmountCount / agg.totalCount;
  const hasConsecutive = agg.consecutiveCount > 0;
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  const highVal = tHigh ? Number(tHigh.voidRateGt ?? NaN) : NaN;
  const medVal = tMed ? Number(tMed.voidRateGt ?? NaN) : NaN;

  let level: DetectResult['level'] | null = null;
  let thresholdValue: string | undefined;
  // 作废率命中阈值
  if (!Number.isNaN(highVal) && voidRate > highVal) {
    level = 'HIGH';
    thresholdValue = thresholdHigh;
  } else if (!Number.isNaN(medVal) && voidRate > medVal) {
    level = 'MEDIUM';
    thresholdValue = thresholdMedium;
  } else if (topRate > 0.2) {
    // 顶额开票占比 > 20%
    level = 'HIGH';
    thresholdValue = '顶额开票占比>20%';
  } else if (hasConsecutive) {
    // 连号发票
    level = 'MEDIUM';
    thresholdValue = '存在连号发票';
  }
  void thresholdLow; // 低风险阈值本指标暂不使用
  if (!level) return null;
  const parts: string[] = [];
  if (voidRate > 0) parts.push(`作废率 ${(voidRate * 100).toFixed(1)}%`);
  if (topRate > 0) parts.push(`顶额开票占比 ${(topRate * 100).toFixed(1)}%`);
  if (hasConsecutive) parts.push(`连号发票 ${agg.consecutiveCount} 组`);
  return {
    hit: true,
    level,
    metricValue: `voidRate=${voidRate.toFixed(4)},topRate=${topRate.toFixed(4)},consecutive=${agg.consecutiveCount}`,
    thresholdValue,
    description: `发票异常：${parts.join('；') || '存在异常'}`,
    suggestion: '核查作废发票原因、顶额开票业务真实性及连号发票是否为正常经营，防范虚开发票风险。',
  };
}

// 5. 库存账实不符：进销项金额差与账面库存变动比较
async function detectInventoryMismatch(
  subjectId: number,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  thresholdLow?: string | null
): Promise<DetectResult | null> {
  const inv = await aggregateInvoices(subjectId, start, end);
  const pnl = await aggregatePnl(subjectId, start, end);
  // 进销差额（购入-售出，按不含税金额）
  const inOutDiff = inv.inputAmount - inv.outputAmount;
  // 账面库存变动（库存商品本期借方-贷方）
  const bookChange = pnl.inventoryChange;
  const denom = Math.max(Math.abs(inOutDiff), Math.abs(bookChange), 1);
  const diff = Math.abs(inOutDiff - bookChange) / denom;
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  const tLow = parseThreshold(thresholdLow);
  let level: DetectResult['level'] | null = null;
  let thresholdValue: string | undefined;
  if (tHigh && matchNumericThreshold(tHigh, diff)) {
    level = 'HIGH';
    thresholdValue = thresholdHigh;
  } else if (tMed && matchNumericThreshold(tMed, diff)) {
    level = 'MEDIUM';
    thresholdValue = thresholdMedium;
  } else if (tLow && matchNumericThreshold(tLow, diff)) {
    level = 'LOW';
    thresholdValue = thresholdLow ?? undefined;
  }
  if (!level) return null;
  return {
    hit: true,
    level,
    metricValue: diff.toFixed(4),
    thresholdValue,
    description: `库存账实差异率 ${diff.toFixed(4)}（进销差额 ${inOutDiff.toFixed(2)} vs 账面库存变动 ${bookChange.toFixed(2)}）`,
    suggestion: '核对库存商品明细账与发票进销逻辑，排查是否存在未入账采购或销售、库存盘亏未处理等情况。',
  };
}

// 6. 资金流异常：资金回流检测
async function detectFundFlowAbnormal(
  subjectId: number,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  _thresholdLow?: string | null
): Promise<DetectResult | null> {
  const txns = await prisma.bankTransaction.findMany({
    where: { subjectId, transDate: { gte: start, lte: end } },
  });
  if (txns.length === 0) return null;
  // 按对手方聚合：收入(IN)与支出(OUT)
  const map = new Map<string, { in: number; out: number }>();
  for (const t of txns) {
    const cp = (t.counterparty || '').trim();
    if (!cp) continue;
    const cur = map.get(cp) ?? { in: 0, out: 0 };
    const amt = Number(t.amount.toString());
    if (t.direction === 'IN') cur.in += amt;
    else cur.out += amt;
    map.set(cp, cur);
  }
  // 资金回流：同一对手方既有收入又有支出，且 |净额| < 总额的 5%
  let roundTripCp: string | null = null;
  let maxTotal = 0;
  for (const [cp, v] of map.entries()) {
    if (v.in > 0 && v.out > 0) {
      const total = v.in + v.out;
      const net = Math.abs(v.in - v.out);
      if (net < total * 0.05 && total > maxTotal) {
        roundTripCp = cp;
        maxTotal = total;
      }
    }
  }
  // 阈值为 roundTrip:true 才视为命中
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  const wantRoundTrip = (tHigh?.roundTrip === true) || (tMed?.roundTrip === true);
  if (!roundTripCp || !wantRoundTrip) return null;
  // 高风险阈值配置了 roundTrip 则 HIGH，否则 MEDIUM
  const level: DetectResult['level'] = tHigh?.roundTrip === true ? 'HIGH' : 'MEDIUM';
  return {
    hit: true,
    level,
    metricValue: `roundTripCp=${roundTripCp},total=${maxTotal.toFixed(2)}`,
    thresholdValue: '{roundTrip:true}',
    description: `检测到资金回流：对手方「${roundTripCp}」同时存在收入与支出，净额接近0，疑似资金走账`,
    suggestion: '核查该对手方交易真实性，确认是否为关联方资金回流或虚增收入走账。',
  };
}

// 7. 关联交易定价异常：无关联方主数据，基于对手方名称关键字匹配（简化）
async function detectRelatedTransaction(
  subjectId: number,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  _thresholdLow?: string | null
): Promise<DetectResult | null> {
  // 关联方关键字
  const keywords = ['关联', '集团', '母公司', '子公司', '控股', '兄弟'];
  // 在发票购销方与银行流水对手方中搜索
  const invoices = await prisma.invoice.findMany({
    where: { subjectId, billingDate: { gte: start, lte: end } },
    select: { buyerName: true, sellerName: true, amountInclTax: true, direction: true },
  });
  const txns = await prisma.bankTransaction.findMany({
    where: { subjectId, transDate: { gte: start, lte: end } },
    select: { counterparty: true, amount: true },
  });
  const matchedNames = new Set<string>();
  let matchedAmount = 0;
  for (const inv of invoices) {
    const names = [inv.buyerName, inv.sellerName].filter(Boolean) as string[];
    for (const n of names) {
      if (keywords.some((k) => n.includes(k))) {
        matchedNames.add(n);
        matchedAmount += Number(inv.amountInclTax.toString());
        break;
      }
    }
  }
  for (const t of txns) {
    if (t.counterparty && keywords.some((k) => t.counterparty!.includes(k))) {
      matchedNames.add(t.counterparty);
      matchedAmount += Number(t.amount.toString());
    }
  }
  if (matchedNames.size === 0) return null;
  // 命中即视为偏离（无独立交易基准价，标记需人工复核）
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  // 偏离度简化为固定值（需人工复核）
  const deviation = 0.25;
  let level: DetectResult['level'] = 'MEDIUM';
  let thresholdValue = thresholdMedium;
  const highVal = tHigh ? Number(tHigh.deviationGt ?? NaN) : NaN;
  if (!Number.isNaN(highVal) && deviation > highVal) {
    level = 'HIGH';
    thresholdValue = thresholdHigh;
  }
  return {
    hit: true,
    level,
    metricValue: `deviation≈${deviation.toFixed(2)}(需人工复核)`,
    thresholdValue,
    description: `检测到疑似关联方交易：${[...matchedNames].slice(0, 5).join('、')}，涉及金额 ${matchedAmount.toFixed(2)}，定价偏离需人工复核`,
    suggestion: '补充关联方关系主数据，按独立交易原则复核关联交易定价，必要时进行转让定价调整。',
  };
}

// 8. 长期零申报/微利申报：连续零申报 或 利润率<1%
async function detectLongZeroFiling(
  subjectId: number,
  period: string,
  _start: Date,
  _end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  _thresholdLow?: string | null
): Promise<DetectResult | null> {
  // 连续零申报：从当期往前查 6 期，统计连续销项=0 的期数
  let consecutiveZero = 0;
  let curPeriod = period;
  for (let i = 0; i < 6; i++) {
    const { start, end } = periodBounds(curPeriod);
    const agg = await aggregateInvoices(subjectId, start, end);
    if (agg.outputAmount <= 0 && agg.outputTax <= 0) {
      consecutiveZero++;
      curPeriod = previousPeriod(curPeriod);
    } else {
      break;
    }
  }
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  const highZero = tHigh ? Number(tHigh.consecutiveZeroGte ?? NaN) : NaN;

  // 微利：利润率 < 1%
  const { start, end } = periodBounds(period);
  const pnl = await aggregatePnl(subjectId, start, end);
  let profitRatio = 0;
  if (pnl.revenue > 0) {
    profitRatio = (pnl.revenue - pnl.expense) / pnl.revenue;
  }
  const medProfit = tMed ? Number(tMed.profitRatioLt ?? NaN) : NaN;

  // 优先 HIGH：连续零申报
  if (!Number.isNaN(highZero) && consecutiveZero >= highZero) {
    return {
      hit: true,
      level: 'HIGH',
      metricValue: `consecutiveZero=${consecutiveZero}`,
      thresholdValue: thresholdHigh,
      description: `连续 ${consecutiveZero} 期零申报（销项销售额为0），疑似隐瞒收入`,
      suggestion: '核查长期零申报原因，确认是否存在隐匿销售收入、未开票收入未申报等情况。',
    };
  }
  // MEDIUM：微利
  if (!Number.isNaN(medProfit) && profitRatio < medProfit && pnl.revenue > 0) {
    return {
      hit: true,
      level: 'MEDIUM',
      metricValue: `profitRatio=${profitRatio.toFixed(4)}`,
      thresholdValue: thresholdMedium,
      description: `利润率 ${profitRatio.toFixed(4)}（收入 ${pnl.revenue.toFixed(2)} - 成本费用 ${pnl.expense.toFixed(2)}），长期偏低`,
      suggestion: '核查是否存在虚列费用、少计收入或将资本性支出费用化等情况。',
    };
  }
  return null;
}

// 9. 期末留抵异常：留抵税额占进项比例
async function detectExcessCredit(
  subjectId: number,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  thresholdLow?: string | null
): Promise<DetectResult | null> {
  const { inputTax, outputTax } = await aggregateInvoices(subjectId, start, end);
  if (inputTax <= 0) return null;
  const credit = Math.max(0, inputTax - outputTax); // 期末留抵
  const creditRatio = credit / inputTax;
  const tHigh = parseThreshold(thresholdHigh);
  const tMed = parseThreshold(thresholdMedium);
  const tLow = parseThreshold(thresholdLow);
  let level: DetectResult['level'] | null = null;
  let thresholdValue: string | undefined;
  if (tHigh && matchNumericThreshold(tHigh, creditRatio)) {
    level = 'HIGH';
    thresholdValue = thresholdHigh;
  } else if (tMed && matchNumericThreshold(tMed, creditRatio)) {
    level = 'MEDIUM';
    thresholdValue = thresholdMedium;
  } else if (tLow && matchNumericThreshold(tLow, creditRatio)) {
    level = 'LOW';
    thresholdValue = thresholdLow ?? undefined;
  }
  if (!level) return null;
  return {
    hit: true,
    level,
    metricValue: creditRatio.toFixed(4),
    thresholdValue,
    description: `期末留抵税额 ${credit.toFixed(2)}，占进项税额比例 ${(creditRatio * 100).toFixed(1)}%（进项 ${inputTax.toFixed(2)} - 销项 ${outputTax.toFixed(2)}）`,
    suggestion: '核查大额留抵形成原因，确认进项是否真实、销项是否迟计，关注留抵退税合规性。',
  };
}

// 指标编码 -> 检测函数映射
type DetectFn = (
  subjectId: number,
  period: string,
  start: Date,
  end: Date,
  thresholdHigh: string,
  thresholdMedium: string,
  thresholdLow?: string | null
) => Promise<DetectResult | null>;

// 各指标的检测调度（统一签名，内部忽略不需要的参数）
const DETECTORS: Record<string, DetectFn> = {
  VAT_TAX_BURDEN: (sid, _p, s, e, th, tm, tl) => detectVatTaxBurden(sid, s, e, th, tm, tl),
  INPUT_OUTPUT_MISMATCH: (sid, p, s, e, th, tm, tl) => detectInputOutputMismatch(sid, p, s, e, th, tm, tl),
  REVENUE_COST_MISMATCH: (sid, _p, s, e, th, tm, tl) => detectRevenueCostMismatch(sid, s, e, th, tm, tl),
  INVOICE_ABNORMAL: (sid, _p, s, e, th, tm, tl) => detectInvoiceAbnormal(sid, s, e, th, tm, tl),
  INVENTORY_MISMATCH: (sid, _p, s, e, th, tm, tl) => detectInventoryMismatch(sid, s, e, th, tm, tl),
  FUND_FLOW_ABNORMAL: (sid, _p, s, e, th, tm, tl) => detectFundFlowAbnormal(sid, s, e, th, tm, tl),
  RELATED_TRANSACTION: (sid, _p, s, e, th, tm, tl) => detectRelatedTransaction(sid, s, e, th, tm, tl),
  LONG_ZERO_FILING: (sid, p, _s, _e, th, tm, tl) => detectLongZeroFiling(sid, p, _s, _e, th, tm, tl),
  EXCESS_CREDIT: (sid, _p, s, e, th, tm, tl) => detectExcessCredit(sid, s, e, th, tm, tl),
};

// ============ 高风险推送 ============

// 高风险事件推送管理员：写入一条 AuditLog，action=RISK_ALERT_HIGH
async function notifyAdmins(eventId: number, subjectId: number, level: string, description: string) {
  try {
    await auditRepo.create({
      userId: 0, // 系统触发，userId=0
      action: 'RISK_ALERT_HIGH',
      target: `riskEvent:${eventId}`,
      ip: '',
      detail: JSON.stringify({ subjectId, level, description }),
    });
  } catch (err) {
    // 推送失败不影响扫描流程
    // eslint-disable-next-line no-console
    console.error('[风险告警推送失败]', err);
  }
}

// ============ 核心扫描：scanSubject ============

// 对某主体扫描指定指标（默认全部 enabled 指标）
// 命中则创建/更新 RiskEvent（去重：同 subjectId+indicatorId+period 已有活跃事件则只更新）
export async function scanSubject(
  subjectId: number,
  indicatorCodes?: string[],
  period?: string | null
): Promise<ScanSummary> {
  // 校验主体存在
  const subject = await prisma.taxpayerSubject.findUnique({ where: { id: subjectId } });
  if (!subject) {
    throw new Error('纳税人主体不存在');
  }

  // 加载指标
  const where: Prisma.RiskIndicatorWhereInput = { enabled: true };
  if (indicatorCodes && indicatorCodes.length > 0) {
    where.code = { in: indicatorCodes };
  }
  const indicators = await prisma.riskIndicator.findMany({ where, orderBy: { id: 'asc' } });

  const resolvedPeriod = await resolvePeriod(subjectId, period);
  const { start, end } = periodBounds(resolvedPeriod);

  const events: ScanSummary['events'] = [];
  let hit = 0;

  for (const ind of indicators) {
    const detector = DETECTORS[ind.code];
    if (!detector) continue; // 无对应检测函数，跳过
    let result: DetectResult | null = null;
    try {
      result = await detector(
        subjectId,
        resolvedPeriod,
        start,
        end,
        ind.thresholdHigh,
        ind.thresholdMedium,
        ind.thresholdLow
      );
    } catch (err) {
      // 单指标检测异常不影响其他指标
      // eslint-disable-next-line no-console
      console.error(`[风险扫描] 指标 ${ind.code} 检测异常:`, err);
      continue;
    }
    if (!result || !result.hit) continue;
    hit++;

    // 去重：查找同主体+指标+期次的活跃事件
    const existing = await prisma.riskEvent.findFirst({
      where: {
        subjectId,
        indicatorId: ind.id,
        period: resolvedPeriod,
        status: { in: ACTIVE_EVENT_STATUSES },
      },
    });

    if (existing) {
      // 已存在活跃事件：仅更新指标值与描述（保留状态与整改任务）
      await prisma.riskEvent.update({
        where: { id: existing.id },
        data: {
          level: result.level,
          metricValue: result.metricValue,
          thresholdValue: result.thresholdValue ?? null,
          description: result.description,
          suggestion: result.suggestion ?? existing.suggestion,
          detectedAt: new Date(),
        },
      });
      events.push({ id: existing.id, indicatorCode: ind.code, level: result.level, status: existing.status });
    } else {
      // 新建风险事件
      const created = await prisma.riskEvent.create({
        data: {
          subjectId,
          indicatorId: ind.id,
          period: resolvedPeriod,
          level: result.level,
          metricValue: result.metricValue,
          thresholdValue: result.thresholdValue ?? null,
          description: result.description,
          suggestion: result.suggestion ?? null,
          status: 'PENDING',
        },
      });
      events.push({ id: created.id, indicatorCode: ind.code, level: result.level, status: 'PENDING' });
      // 高风险推送管理员
      if (result.level === 'HIGH') {
        // 异步推送，不阻塞扫描
        setImmediate(() => {
          notifyAdmins(created.id, subjectId, result.level, result.description).catch(() => undefined);
        });
      }
    }
  }

  return { subjectId, period: resolvedPeriod, scanned: indicators.length, hit, events };
}

// ============ 重扫：rescanAll ============

// 按当前阈值重新扫描所有历史数据：更新已存在事件或关闭不再命中事件
// subjectId 为空则扫描所有主体
export async function rescanAll(subjectId?: number): Promise<Array<ScanSummary & { closed: number }>> {
  const subjectWhere: Prisma.TaxpayerSubjectWhereInput = {};
  if (subjectId) subjectWhere.id = subjectId;
  const subjects = await prisma.taxpayerSubject.findMany({ where: subjectWhere });

  const results: Array<ScanSummary & { closed: number }> = [];

  for (const subject of subjects) {
    // 先按正常流程扫描（创建/更新命中事件）
    const summary = await scanSubject(subject.id);
    let closed = 0;
    // 关闭不再命中的活跃事件
    const activeEvents = await prisma.riskEvent.findMany({
      where: { subjectId: subject.id, status: { in: ACTIVE_EVENT_STATUSES } },
    });
    // 本次扫描命中事件的 indicatorCode+period 集合
    const hitKeys = new Set(
      summary.events.map((e) => `${e.indicatorCode}|${summary.period}`)
    );
    for (const ev of activeEvents) {
      const ind = await prisma.riskIndicator.findUnique({ where: { id: ev.indicatorId } });
      const key = `${ind?.code ?? ''}|${ev.period ?? ''}`;
      // 仅关闭本次扫描期次内且未命中的事件
      if (ev.period === summary.period && !hitKeys.has(key)) {
        await prisma.riskEvent.update({
          where: { id: ev.id },
          data: {
            status: 'RESOLVED',
            resolution: '重扫后未命中当前阈值，自动关闭',
            resolvedAt: new Date(),
          },
        });
        closed++;
      }
    }
    results.push({ ...summary, closed });
  }

  return results;
}

// ============ 触发扫描（异步、不阻塞、加锁防并发） ============

// 正在扫描的主体集合，防止并发重复扫描
const scanningSubjects = new Set<number>();

// 被外部调用：异步触发扫描，不阻塞调用方（满足 5 秒内扫描要求）
// source 标识触发来源（如 'VOUCHER_POSTED'、'DATA_IMPORTED'），用于日志
export function triggerScan(subjectId: number, source: string): void {
  // 加锁：同主体正在扫描则跳过
  if (scanningSubjects.has(subjectId)) {
    // eslint-disable-next-line no-console
    console.log(`[风险扫描] 主体 ${subjectId} 正在扫描，跳过本次触发（来源:${source}）`);
    return;
  }
  scanningSubjects.add(subjectId);
  // 异步执行，不阻塞调用方
  setImmediate(() => {
    scanSubject(subjectId)
      .then((summary) => {
        // eslint-disable-next-line no-console
        console.log(
          `[风险扫描] 主体 ${subjectId} 扫描完成（来源:${source}）：扫描 ${summary.scanned} 指标，命中 ${summary.hit}`
        );
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[风险扫描] 主体 ${subjectId} 扫描失败（来源:${source}）:`, err);
      })
      .finally(() => {
        scanningSubjects.delete(subjectId);
      });
  });
}

// ============ 钩子函数：供凭证服务/导入服务调用 ============

// 凭证过账后触发扫描
export function onVoucherPosted(subjectId: number): void {
  triggerScan(subjectId, 'VOUCHER_POSTED');
}

// 数据导入后触发扫描
export function onDataImported(subjectId: number, dataType: string): void {
  triggerScan(subjectId, `DATA_IMPORTED:${dataType}`);
}
