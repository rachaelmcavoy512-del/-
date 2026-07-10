// 税务申报生成服务（Task6）
// 基于已过账凭证（VoucherEntry）和发票数据（Invoice）归集生成各税种申报表。
//
// 余额/发生额说明：与 voucherService 一致，计入余额的凭证状态为 POSTED 与 RED_VOID
// （红冲凭证已自动过账）。本期发生额取该期间内的借/贷方合计；期初余额取期间开始前
// 的累计余额（按科目余额方向）。

import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

// ============ 状态常量 ============

// 计入余额的凭证状态：POSTED 与 RED_VOID（红冲已自动过账）
const POSTED_STATUSES = ['POSTED', 'RED_VOID'];

// ============ 科目编码常量 ============

// 增值税相关科目
const ACCT_OUTPUT_TAX = '22210101'; // 销项税额（一般纳税人）
const ACCT_INPUT_TAX = '22210102'; // 进项税额（一般纳税人）
// 损益类科目
const ACCT_MAIN_REVENUE = '6001'; // 主营业务收入
const ACCT_OTHER_REVENUE = '6051'; // 其他业务收入
const ACCT_MAIN_COST = '6401'; // 主营业务成本
const ACCT_OTHER_COST = '6402'; // 其他业务成本
const ACCT_TAX_SURCHARGE = '6403'; // 税金及附加
const ACCT_SELLING_EXP = '6601'; // 销售费用
const ACCT_ADMIN_EXP = '6602'; // 管理费用
const ACCT_FIN_EXP = '6603'; // 财务费用

// ============ 期间解析 ============

// 期间解析：将 period 字符串解析为 { start, end, label, kind }
// - YYYY-MM：月度，所属期为该月
// - YYYY-Q1..Q4：季度，所属期为该季度三个月
// - YYYY-FY：年度汇算清缴，所属期为整年
// - YYYY：等同于 YYYY-FY
export interface PeriodRange {
  start: Date;
  end: Date;
  label: string;
  kind: 'MONTH' | 'QUARTER' | 'YEAR';
  year: number;
}

export function parsePeriodRange(period: string): PeriodRange {
  const trimmed = period.trim();

  // 年度汇算清缴 YYYY-FY 或 YYYY
  const fyMatch = trimmed.match(/^(\d{4})-FY$/);
  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (fyMatch || yearOnly) {
    const year = Number((fyMatch ?? yearOnly)![1]);
    const start = new Date(year, 0, 1, 0, 0, 0, 0);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    return { start, end, label: `${year}年度`, kind: 'YEAR', year };
  }

  // 季度 YYYY-Q1..Q4
  const qMatch = trimmed.match(/^(\d{4})-Q([1-4])$/);
  if (qMatch) {
    const year = Number(qMatch[1]);
    const q = Number(qMatch[2]);
    const startMonth = (q - 1) * 3; // 0-based
    const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
    const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
    return { start, end, label: `${year}年第${q}季度`, kind: 'QUARTER', year };
  }

  // 月度 YYYY-MM
  const mMatch = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (mMatch) {
    const year = Number(mMatch[1]);
    const month = Number(mMatch[2]);
    if (month < 1 || month > 12) {
      throw new Error(`无效的期间: ${period}`);
    }
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    return { start, end, label: `${year}年${month}月`, kind: 'MONTH', year };
  }

  throw new Error(`无效的期间格式: ${period}，支持 YYYY-MM / YYYY-Q1..Q4 / YYYY-FY`);
}

// ============ 通用辅助 ============

// 保留两位小数（四舍五入），避免浮点误差
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// 按科目编码获取该主体的科目记录
async function getAccountByCode(subjectId: number, code: string) {
  return prisma.account.findFirst({ where: { subjectId, code } });
}

// 聚合某科目在指定日期范围内已过账凭证的借/贷方发生额
async function aggregateRange(
  subjectId: number,
  accountId: number,
  start: Date,
  end: Date
): Promise<{ debit: number; credit: number }> {
  const result = await prisma.voucherEntry.aggregate({
    _sum: { debit: true, credit: true },
    where: {
      accountId,
      voucher: {
        subjectId,
        status: { in: POSTED_STATUSES },
        voucherDate: { gte: start, lte: end },
      },
    },
  });
  return {
    debit: Number((result._sum.debit ?? new Prisma.Decimal(0)).toString()),
    credit: Number((result._sum.credit ?? new Prisma.Decimal(0)).toString()),
  };
}

// 计算某科目截至 start 之前的期初余额（按余额方向）
async function getOpeningBalance(
  subjectId: number,
  accountId: number,
  before: Date
): Promise<number> {
  const account = await prisma.account.findFirst({ where: { id: accountId, subjectId } });
  if (!account) return 0;
  const result = await prisma.voucherEntry.aggregate({
    _sum: { debit: true, credit: true },
    where: {
      accountId,
      voucher: {
        subjectId,
        status: { in: POSTED_STATUSES },
        voucherDate: { lt: before },
      },
    },
  });
  const debit = Number((result._sum.debit ?? new Prisma.Decimal(0)).toString());
  const credit = Number((result._sum.credit ?? new Prisma.Decimal(0)).toString());
  return account.balanceDirection === 'DEBIT' ? debit - credit : credit - debit;
}

// 获取某科目在期间内的"自然方向发生额"（贷方科目取贷方，借方科目取借方）
// 用于归集收入、成本等的发生额
async function getPeriodOccurrence(
  subjectId: number,
  code: string,
  range: PeriodRange
): Promise<number> {
  const account = await getAccountByCode(subjectId, code);
  if (!account) return 0;
  const { debit, credit } = await aggregateRange(subjectId, account.id, range.start, range.end);
  return account.balanceDirection === 'DEBIT' ? debit : credit;
}

// 按主体+期间获取发票列表
async function getInvoicesByPeriod(
  subjectId: number,
  range: PeriodRange,
  direction?: 'INPUT' | 'OUTPUT'
) {
  return prisma.invoice.findMany({
    where: {
      subjectId,
      billingDate: { gte: range.start, lte: range.end },
      status: 'NORMAL',
      ...(direction ? { direction } : {}),
    },
  });
}

// 获取纳税人主体（带类型校验）
async function getSubject(subjectId: number) {
  const subject = await prisma.taxpayerSubject.findUnique({ where: { id: subjectId } });
  if (!subject) {
    throw new Error('纳税人主体不存在');
  }
  return subject;
}

// ============ 增值税申报 ============

// 计算本期应纳增值税额（用于附加税基础及 VAT 主表）
// 一般纳税人：应纳税额 = max(0, 本期销项 - 期初留抵 - 本期进项)
// 小规模：应纳税额 = 销售额 × 征收率
export async function getVATPayable(subjectId: number, period: string): Promise<number> {
  const subject = await getSubject(subjectId);
  const range = parsePeriodRange(period);

  if (subject.taxpayerType === 'GENERAL') {
    const outputAcct = await getAccountByCode(subjectId, ACCT_OUTPUT_TAX);
    const inputAcct = await getAccountByCode(subjectId, ACCT_INPUT_TAX);
    // 本期销项（销项税额科目贷方发生额）
    const outputTax = outputAcct
      ? (await aggregateRange(subjectId, outputAcct.id, range.start, range.end)).credit
      : 0;
    // 本期进项（进项税额科目借方发生额）
    const inputTax = inputAcct
      ? (await aggregateRange(subjectId, inputAcct.id, range.start, range.end)).debit
      : 0;
    // 期初留抵（进项税额科目期初借方余额）
    const openingCredit = inputAcct
      ? await getOpeningBalance(subjectId, inputAcct.id, range.start)
      : 0;
    const payable = outputTax - openingCredit - inputTax;
    return round2(Math.max(0, payable));
  }

  // 小规模：销售额 × 征收率
  const report = await generateVATReturn(subjectId, period);
  return round2(report.summary.taxAmount);
}

// 生成增值税申报表
export async function generateVATReturn(subjectId: number, period: string) {
  const subject = await getSubject(subjectId);
  const range = parsePeriodRange(period);
  const taxpayerType = subject.taxpayerType;

  if (taxpayerType === 'GENERAL') {
    return generateGeneralVATReturn(subject, range);
  }
  return generateSmallScaleVATReturn(subject, range);
}

// 一般纳税人增值税申报表
async function generateGeneralVATReturn(
  subject: { id: number; name: string; taxNumber: string },
  range: PeriodRange
) {
  // ---------- 附列资料(一) 销售额及销项税额 ----------
  // 按发票 direction=OUTPUT 销项 + 销项税额科目(22210101)，区分税率汇总
  const outputInvoices = await getInvoicesByPeriod(subject.id, range, 'OUTPUT');
  const outputAcct = await getAccountByCode(subject.id, ACCT_OUTPUT_TAX);

  // 按税率归集发票销售额与税额
  const rateMap = new Map<number, { sales: number; tax: number; count: number }>();
  for (const inv of outputInvoices) {
    const rate = Number(inv.taxRate.toString());
    const sales = Number(inv.amountExclTax.toString());
    const tax = Number(inv.taxAmount.toString());
    const cur = rateMap.get(rate) ?? { sales: 0, tax: 0, count: 0 };
    cur.sales += sales;
    cur.tax += tax;
    cur.count += 1;
    rateMap.set(rate, cur);
  }

  // 凭证销项税额科目贷方合计（用于与发票交叉核对）
  const voucherOutputTax = outputAcct
    ? (await aggregateRange(subject.id, outputAcct.id, range.start, range.end)).credit
    : 0;

  const schedule1Rows = Array.from(rateMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([rate, v]) => ({
      taxRate: rate,
      salesAmount: round2(v.sales),
      outputTax: round2(v.tax),
      invoiceCount: v.count,
    }));
  const invoiceSalesTotal = schedule1Rows.reduce((s, r) => s + r.salesAmount, 0);
  const invoiceOutputTaxTotal = schedule1Rows.reduce((s, r) => s + r.outputTax, 0);

  const schedule1 = {
    title: '附列资料(一) 销售额及销项税额',
    rows: schedule1Rows,
    invoiceSalesTotal: round2(invoiceSalesTotal),
    invoiceOutputTaxTotal: round2(invoiceOutputTaxTotal),
    voucherOutputTax: round2(voucherOutputTax), // 凭证销项税额合计（交叉核对）
    outputTaxUsed: round2(voucherOutputTax || invoiceOutputTaxTotal), // 主表采用凭证数，无凭证则用发票数
  };

  // ---------- 附列资料(二) 进项税额 ----------
  const inputInvoices = await getInvoicesByPeriod(subject.id, range, 'INPUT');
  const inputAcct = await getAccountByCode(subject.id, ACCT_INPUT_TAX);

  // 简化：发票中状态 NORMAL 视为认证抵扣，无未抵扣分类
  const certifiedInput = inputInvoices.reduce(
    (s, inv) => s + Number(inv.taxAmount.toString()),
    0
  );
  const voucherInputTax = inputAcct
    ? (await aggregateRange(subject.id, inputAcct.id, range.start, range.end)).debit
    : 0;

  const schedule2 = {
    title: '附列资料(二) 进项税额',
    certifiedInput: round2(certifiedInput), // 认证抵扣进项（发票口径）
    uncertifiedInput: 0, // 未抵扣进项（简化为0）
    invoiceCount: inputInvoices.length,
    voucherInputTax: round2(voucherInputTax), // 凭证进项税额合计（交叉核对）
    inputTaxUsed: round2(voucherInputTax || certifiedInput), // 主表采用凭证数
  };

  // ---------- 附列资料(三)(四)(五) 简化 ----------
  const schedule3 = { title: '附列资料(三) 待抵扣进项税额', amount: 0 };
  const schedule4 = { title: '附列资料(四) 抵减台账', amount: 0 };
  const schedule5 = { title: '附列资料(五) 不动产抵扣', amount: 0 };

  // ---------- 主表 ----------
  const openingCredit = inputAcct // 期初留抵税额（进项科目期初借方余额）
    ? await getOpeningBalance(subject.id, inputAcct.id, range.start)
    : 0;
  const currentOutputTax = schedule1.outputTaxUsed;
  const currentInputTax = schedule2.inputTaxUsed;

  // 应纳税额 = max(0, 销项 - 期初留抵 - 本期进项)
  const rawPayable = currentOutputTax - openingCredit - currentInputTax;
  const taxPayable = round2(Math.max(0, rawPayable));
  // 期末留抵 = max(0, 期初留抵 + 本期进项 - 销项)
  const endingCredit = round2(Math.max(0, openingCredit + currentInputTax - currentOutputTax));

  const mainForm = {
    title: '增值税纳税申报表(一般纳税人)主表',
    期初留抵税额: round2(Math.max(0, openingCredit)),
    本期销项税额: currentOutputTax,
    本期进项税额: currentInputTax,
    应抵扣税额合计: round2(openingCredit + currentInputTax),
    实际抵扣税额: round2(Math.min(openingCredit + currentInputTax, currentOutputTax)),
    应纳税额: taxPayable,
    期末留抵税额: endingCredit,
  };

  const summary = {
    taxType: 'VAT',
    taxpayerType: 'GENERAL',
    period: range.label,
    salesAmount: schedule1.invoiceSalesTotal,
    outputTax: currentOutputTax,
    inputTax: currentInputTax,
    taxAmount: taxPayable, // 应纳增值税额
    endingCredit,
  };

  return {
    taxpayerType: 'GENERAL',
    taxpayerName: subject.name,
    taxNumber: subject.taxNumber,
    period: range.label,
    periodCode: periodLabelToCode(range),
    schedule1,
    schedule2,
    schedule3,
    schedule4,
    schedule5,
    mainForm,
    summary,
  };
}

// 小规模纳税人增值税申报表
async function generateSmallScaleVATReturn(
  subject: { id: number; name: string; taxNumber: string; taxRate: Prisma.Decimal | null },
  range: PeriodRange
) {
  // 销售额：主营业务收入凭证（不含税）+ 发票销售额
  const voucherRevenue = await getPeriodOccurrence(subject.id, ACCT_MAIN_REVENUE, range);
  const outputInvoices = await getInvoicesByPeriod(subject.id, range, 'OUTPUT');
  const invoiceSales = outputInvoices.reduce(
    (s, inv) => s + Number(inv.amountExclTax.toString()),
    0
  );
  // 取较大者作为销售额口径（凭证与发票取大，确保不漏报）
  const salesAmount = Math.max(voucherRevenue, invoiceSales);

  // 征收率：主体 taxRate 优先，否则默认 3%
  const subjectRate = subject.taxRate ? Number(subject.taxRate.toString()) : null;
  const levyRate = subjectRate && subjectRate > 0 && subjectRate < 1 ? subjectRate : 0.03;

  // 应纳税额 = 销售额 × 征收率
  const taxPayable = round2(salesAmount * levyRate);
  // 本期预缴（简化为0）
  const prePaid = 0;
  const taxPayableAfterPrepay = round2(taxPayable - prePaid);

  const mainForm = {
    title: '增值税纳税申报表(小规模纳税人)主表',
    销售额: round2(salesAmount),
    征收率: levyRate,
    应纳税额: taxPayable,
    本期预缴: prePaid,
    本期应补退税额: taxPayableAfterPrepay,
  };

  const summary = {
    taxType: 'VAT',
    taxpayerType: 'SMALL_SCALE',
    period: range.label,
    salesAmount: round2(salesAmount),
    outputTax: taxPayable,
    inputTax: 0,
    taxAmount: taxPayable,
    endingCredit: 0,
  };

  return {
    taxpayerType: 'SMALL_SCALE',
    taxpayerName: subject.name,
    taxNumber: subject.taxNumber,
    period: range.label,
    periodCode: periodLabelToCode(range),
    voucherRevenue: round2(voucherRevenue),
    invoiceSales: round2(invoiceSales),
    invoiceCount: outputInvoices.length,
    mainForm,
    summary,
  };
}

// ============ 企业所得税申报 ============

// 生成企业所得税申报表
// isAnnual=true 为汇算清缴（年度），否则为季度预缴
export async function generateCITReturn(
  subjectId: number,
  period: string,
  isAnnual = false
) {
  const subject = await getSubject(subjectId);
  const range = parsePeriodRange(period);

  // 营业收入 = 主营业务收入 + 其他业务收入
  const mainRevenue = await getPeriodOccurrence(subjectId, ACCT_MAIN_REVENUE, range);
  const otherRevenue = await getPeriodOccurrence(subjectId, ACCT_OTHER_REVENUE, range);
  const revenue = mainRevenue + otherRevenue;

  // 营业成本 = 主营业务成本 + 其他业务成本
  const mainCost = await getPeriodOccurrence(subjectId, ACCT_MAIN_COST, range);
  const otherCost = await getPeriodOccurrence(subjectId, ACCT_OTHER_COST, range);
  const cost = mainCost + otherCost;

  // 期间费用 = 税金及附加 + 销售费用 + 管理费用 + 财务费用
  const taxSurcharges = await getPeriodOccurrence(subjectId, ACCT_TAX_SURCHARGE, range);
  const sellingExp = await getPeriodOccurrence(subjectId, ACCT_SELLING_EXP, range);
  const adminExp = await getPeriodOccurrence(subjectId, ACCT_ADMIN_EXP, range);
  const finExp = await getPeriodOccurrence(subjectId, ACCT_FIN_EXP, range);
  const expenses = taxSurcharges + sellingExp + adminExp + finExp;

  // 利润总额 = 营业收入 - 营业成本 - 期间费用
  const profit = revenue - cost - expenses;

  let taxRate = 0.25; // 法定税率 25%
  let taxAmount: number;
  let preferential = false;
  let preferentialDetail = '';

  if (isAnnual) {
    // 汇算清缴（年度）：简化版
    // 应纳税所得额 = 收入总额 - 不征税收入 - 免税收入 - 各项扣除 - 弥补亏损
    // 此处简化：调整项为0，应纳税所得额 = 利润总额（不弥补亏损）
    const taxableIncome = Math.max(0, profit);
    // 小型微利优惠判定（简化：应纳税所得额 ≤ 300万）
    if (taxableIncome > 0 && taxableIncome <= 1000000) {
      // ≤100万部分按 25% 计入 × 20%
      taxAmount = round2(taxableIncome * 0.25 * 0.2);
      preferential = true;
      preferentialDetail = '小型微利企业：应纳税所得额≤100万部分按25%计入×20%';
    } else if (taxableIncome > 1000000 && taxableIncome <= 3000000) {
      // 100万部分 + 超过部分按 50% 计入 × 20%
      taxAmount = round2(1000000 * 0.25 * 0.2 + (taxableIncome - 1000000) * 0.5 * 0.2);
      preferential = true;
      preferentialDetail = '小型微利企业：100万部分按25%计入×20%，100-300万部分按50%计入×20%';
    } else {
      taxAmount = round2(taxableIncome * taxRate);
      preferentialDetail = '一般企业：25%法定税率';
    }
  } else {
    // 季度预缴：按利润总额 × 适用税率（简化，小型微利优惠同年度口径）
    const taxableIncome = Math.max(0, profit);
    if (taxableIncome > 0 && taxableIncome <= 1000000) {
      taxAmount = round2(taxableIncome * 0.25 * 0.2);
      preferential = true;
      preferentialDetail = '小型微利企业优惠：应纳税所得额≤100万按25%计入×20%';
    } else if (taxableIncome > 1000000 && taxableIncome <= 3000000) {
      taxAmount = round2(1000000 * 0.25 * 0.2 + (taxableIncome - 1000000) * 0.5 * 0.2);
      preferential = true;
      preferentialDetail = '小型微利企业优惠：100万部分按25%计入×20%，100-300万部分按50%计入×20%';
    } else if (taxableIncome > 3000000) {
      taxAmount = round2(taxableIncome * taxRate);
      preferentialDetail = '超过300万，按25%法定税率';
    } else {
      taxAmount = 0;
      preferentialDetail = '应纳税所得额为0，无需缴纳';
    }
  }

  const report = {
    taxType: 'CIT',
    taxpayerName: subject.name,
    taxNumber: subject.taxNumber,
    period: range.label,
    periodCode: periodLabelToCode(range),
    isAnnual,
    declarationType: isAnnual ? '年度汇算清缴' : '季度预缴',
    revenue: round2(revenue),
    cost: round2(cost),
    expenses: round2(expenses),
    expenseDetail: {
      税金及附加: round2(taxSurcharges),
      销售费用: round2(sellingExp),
      管理费用: round2(adminExp),
      财务费用: round2(finExp),
    },
    profit: round2(profit),
    taxRate,
    preferential,
    preferentialDetail,
    taxableIncome: round2(Math.max(0, profit)),
    taxAmount,
    summary: {
      taxType: 'CIT',
      period: range.label,
      revenue: round2(revenue),
      cost: round2(cost),
      profit: round2(profit),
      taxRate,
      taxAmount,
    },
  };

  return report;
}

// ============ 附加税申报 ============

// 生成附加税申报表（基于本期应纳增值税额）
// 城建税率默认 7%（市区），教育费附加 3%，地方教育附加 2%
export async function generateSurTaxReturn(
  subjectId: number,
  period: string,
  urbanRate = 0.07
) {
  const subject = await getSubject(subjectId);
  const range = parsePeriodRange(period);

  // 本期应纳增值税额（附加税计税依据）
  const vatPayable = await getVATPayable(subjectId, period);

  // 城建税率校验
  const cityRate = [0.07, 0.05, 0.01].includes(urbanRate) ? urbanRate : 0.07;
  const cityTax = round2(vatPayable * cityRate);
  const eduSurcharge = round2(vatPayable * 0.03);
  const localEduSurcharge = round2(vatPayable * 0.02);
  const total = round2(cityTax + eduSurcharge + localEduSurcharge);

  const report = {
    taxType: 'SURTAX',
    taxpayerName: subject.name,
    taxNumber: subject.taxNumber,
    period: range.label,
    periodCode: periodLabelToCode(range),
    vatPayable: round2(vatPayable), // 计税依据（应纳增值税额）
    cityRate,
    items: [
      { name: '城建税', rate: cityRate, amount: cityTax, account: '222105' },
      { name: '教育费附加', rate: 0.03, amount: eduSurcharge, account: '222106' },
      { name: '地方教育附加', rate: 0.02, amount: localEduSurcharge, account: '222107' },
    ],
    total,
    summary: {
      taxType: 'SURTAX',
      period: range.label,
      vatPayable: round2(vatPayable),
      taxAmount: total,
    },
  };

  return report;
}

// ============ 个人所得税申报 ============

// 生成个人所得税扣缴申报表（基于 PayrollRecord 汇总）
export async function generateIITReturn(subjectId: number, period: string) {
  const subject = await getSubject(subjectId);
  const range = parsePeriodRange(period);

  // 个税按月扣缴，period 通常是 YYYY-MM；若为季度/年度，则汇总该期间内所有工资记录
  const records = await prisma.payrollRecord.findMany({
    where: {
      subjectId,
      // payrollRecord.period 为 YYYY-MM 字符串，按所属期所属月份落入区间
      // 此处按 period 字符串前缀匹配 + 范围内月份过滤
    },
  });

  // 过滤出 period 落入 range 的记录（payrollRecord.period 形如 YYYY-MM）
  const filtered = records.filter((r) => {
    const d = parsePeriodRange(r.period);
    return d.start >= range.start && d.end <= range.end;
  });

  const headcount = filtered.length;
  const grossSalary = filtered.reduce((s, r) => s + Number(r.grossSalary.toString()), 0);
  const socialInsurance = filtered.reduce((s, r) => s + Number(r.socialInsurance.toString()), 0);
  const housingFund = filtered.reduce((s, r) => s + Number(r.housingFund.toString()), 0);
  const taxWithheld = filtered.reduce((s, r) => s + Number(r.taxWithheld.toString()), 0);
  const netSalary = filtered.reduce((s, r) => s + Number(r.netSalary.toString()), 0);

  const report = {
    taxType: 'IIT',
    taxpayerName: subject.name,
    taxNumber: subject.taxNumber,
    period: range.label,
    periodCode: periodLabelToCode(range),
    headcount,
    grossSalary: round2(grossSalary),
    socialInsurance: round2(socialInsurance),
    housingFund: round2(housingFund),
    taxWithheld: round2(taxWithheld), // 代扣个税合计（应申报税额）
    netSalary: round2(netSalary),
    summary: {
      taxType: 'IIT',
      period: range.label,
      headcount,
      grossSalary: round2(grossSalary),
      taxAmount: round2(taxWithheld),
    },
  };

  return report;
}

// ============ 印花税申报 ============

// 生成印花税申报表（简化：基于购销相关发票金额 × 0.03%）
export async function generateStampTaxReturn(subjectId: number, period: string) {
  const subject = await getSubject(subjectId);
  const range = parsePeriodRange(period);

  // 购销合同金额：进项 + 销项发票不含税金额合计
  const invoices = await getInvoicesByPeriod(subjectId, range);
  const contractAmount = invoices.reduce(
    (s, inv) => s + Number(inv.amountExclTax.toString()),
    0
  );

  // 印花税税率：购销合同 0.03%
  const rate = 0.0003;
  const taxAmount = round2(contractAmount * rate);

  const report = {
    taxType: 'STAMP',
    taxpayerName: subject.name,
    taxNumber: subject.taxNumber,
    period: range.label,
    periodCode: periodLabelToCode(range),
    contractAmount: round2(contractAmount),
    rate,
    taxAmount,
    invoiceCount: invoices.length,
    summary: {
      taxType: 'STAMP',
      period: range.label,
      contractAmount: round2(contractAmount),
      taxAmount,
    },
  };

  return report;
}

// ============ 辅助 ============

// 将期间范围转为所属期编码字符串（YYYYMM / YYYYQ1 / YYYY）
function periodLabelToCode(range: PeriodRange): string {
  if (range.kind === 'MONTH') {
    const month = range.start.getMonth() + 1;
    return `${range.year}${String(month).padStart(2, '0')}`;
  }
  if (range.kind === 'QUARTER') {
    const q = Math.floor(range.start.getMonth() / 3) + 1;
    return `${range.year}Q${q}`;
  }
  return `${range.year}`;
}
