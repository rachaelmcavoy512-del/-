// Task9 集成验证：9类风险指标命中测试脚本（SubTask 9.2）
// 运行：npx ts-node --transpile-only src/tests/risk-indicators.test.ts
//
// 针对9类风险指标分别构造数据并验证命中：
// 1. VAT_TAX_BURDEN        - 增值税税负率异常（大量进项+少销项 → 税负率≈0 <1%）
// 2. INPUT_OUTPUT_MISMATCH - 进销项比对异常（进项税额环比增长>50%）
// 3. REVENUE_COST_MISMATCH - 收入成本匹配异常（成本率>90%）
// 4. INVOICE_ABNORMAL      - 发票异常（作废率>10%）
// 5. INVENTORY_MISMATCH    - 库存账实不符（进销差额与账面库存变动背离>30%）
// 6. FUND_FLOW_ABNORMAL    - 资金流异常（银行流水同对手方进出净额≈0）
// 7. RELATED_TRANSACTION   - 关联交易定价异常（对手方含"集团"等关联方关键字）
// 8. LONG_ZERO_FILING      - 长期零申报（连续≥3期零申报）
// 9. EXCESS_CREDIT         - 期末留抵异常（留抵税额占进项比例>50%）
//
// 测试策略：
// - 主体A：构造综合风险数据，覆盖指标1~7、9（8类，这些指标的数据可共存）
// - 主体B：不创建任何销项发票，覆盖指标8（LONG_ZERO_FILING，需连续零申报）
// - 使用直接 prisma 构造精确数据（VOID发票、银行流水、多期数据），scanSubject 触发扫描

import dotenv from 'dotenv';
dotenv.config();

import prisma from '../utils/prisma';
import { scanSubject } from '../services/riskScanService';
import { GENERAL_TAXPAYER_ACCOUNTS } from '../seed/accounts';

// ============ 常量 ============

const CUR = '2026-07'; // 本期
const PREV = '2026-06'; // 上一期（用于进项环比增长计算）

// ============ 辅助函数 ============

// 期间中旬日期（用于发票开票日期、银行流水日期、凭证日期）
function midDate(period: string): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 15);
}

// 为主体播种一般纳税人科目体系，返回 code -> accountId 映射
async function seedAccounts(subjectId: number): Promise<Map<string, number>> {
  await prisma.account.createMany({
    data: GENERAL_TAXPAYER_ACCOUNTS.map((a) => ({
      subjectId,
      code: a.code,
      name: a.name,
      direction: a.direction,
      level: a.level,
      parentCode: a.parentCode ?? null,
      category: a.category,
      balanceDirection: a.balanceDirection,
      isLeaf: a.isLeaf,
    })),
  });
  const accounts = await prisma.account.findMany({ where: { subjectId } });
  return new Map(accounts.map((a) => [a.code, a.id]));
}

// 创建发票（直接 prisma.create，支持指定状态）
async function createInvoice(data: {
  subjectId: number;
  invoiceCode: string;
  invoiceNo: string;
  direction: 'INPUT' | 'OUTPUT';
  billingDate: Date;
  sellerName: string;
  buyerName: string;
  sellerTaxNo: string;
  buyerTaxNo: string;
  amountExclTax: number;
  taxAmount: number;
  amountInclTax: number;
  taxRate: number;
  status?: 'NORMAL' | 'VOID' | 'RED';
}) {
  return prisma.invoice.create({
    data: {
      subjectId: data.subjectId,
      invoiceCode: data.invoiceCode,
      invoiceNo: data.invoiceNo,
      invoiceType: 'SPECIAL',
      direction: data.direction,
      billingDate: data.billingDate,
      sellerName: data.sellerName,
      buyerName: data.buyerName,
      sellerTaxNo: data.sellerTaxNo,
      buyerTaxNo: data.buyerTaxNo,
      amountExclTax: data.amountExclTax,
      taxAmount: data.taxAmount,
      amountInclTax: data.amountInclTax,
      taxRate: data.taxRate,
      status: data.status ?? 'NORMAL',
    },
  });
}

// 创建已过账凭证（直接 prisma，status=POSTED，含分录）
async function createPostedVoucher(
  subjectId: number,
  voucherNo: string,
  voucherDate: Date,
  summary: string,
  entries: Array<{ accountId: number; debit: number; credit: number }>,
  userId = 1
) {
  return prisma.voucher.create({
    data: {
      subjectId,
      voucherNo,
      voucherDate,
      summary,
      status: 'POSTED',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      entries: {
        create: entries.map((e) => ({
          accountId: e.accountId,
          debit: e.debit,
          credit: e.credit,
        })),
      },
    },
  });
}

// 清理主体所有相关数据（风险事件/整改/发票/银行流水/凭证/科目/主体）
async function cleanupSubject(subjectId: number) {
  await prisma.riskRemediation.deleteMany({ where: { event: { subjectId } } });
  await prisma.riskEvent.deleteMany({ where: { subjectId } });
  await prisma.invoice.deleteMany({ where: { subjectId } });
  await prisma.bankTransaction.deleteMany({ where: { subjectId } });
  await prisma.voucherEntry.deleteMany({ where: { voucher: { subjectId } } });
  await prisma.voucher.deleteMany({ where: { subjectId } });
  await prisma.account.deleteMany({ where: { subjectId } });
  await prisma.taxpayerSubject.delete({ where: { id: subjectId } });
}

// 按税号清理旧主体（若存在）
async function cleanupByTaxNumber(taxNumber: string): Promise<void> {
  const old = await prisma.taxpayerSubject.findUnique({ where: { taxNumber } });
  if (old) {
    await cleanupSubject(old.id);
  }
}

// ============ 断言统计 ============

let passCount = 0;
let failCount = 0;
const results: Array<{ code: string; name: string; hit: boolean; level?: string; detail: string }> = [];

// 记录单个指标命中结果
function recordResult(code: string, name: string, hit: boolean, level: string | undefined, detail: string) {
  results.push({ code, name, hit, level, detail });
  if (hit) {
    passCount++;
    console.log(`  ✅ ${code} 命中（level=${level}）— ${detail}`);
  } else {
    failCount++;
    console.log(`  ❌ ${code} 未命中 — ${detail}`);
  }
}

// ============ 主流程 ============

async function main() {
  console.log('========== Task9 9类风险指标命中测试 ==========\n');

  // 0. 校验指标库
  const indicatorCount = await prisma.riskIndicator.count();
  console.log(`[0] 风险指标库：${indicatorCount} 条内置指标`);
  if (indicatorCount < 9) {
    console.error('  ✗ 指标库不足9条，请先运行 npm run seed');
    process.exit(1);
  }
  const indicators = await prisma.riskIndicator.findMany({ orderBy: { id: 'asc' } });
  console.log('  指标列表：');
  indicators.forEach((i) =>
    console.log(`    - ${i.code} | ${i.name} | high=${i.thresholdHigh} | enabled=${i.enabled}`)
  );

  // ===== 主体A：覆盖8类指标（除 LONG_ZERO_FILING）=====
  console.log('\n[1] 准备主体A（覆盖8类指标：税负率/进销项/收入成本/发票异常/库存/资金流/关联交易/留抵）');
  const taxNumberA = 'TEST-RI-A';
  await cleanupByTaxNumber(taxNumberA);
  console.log('  已清理旧主体A数据');

  // 创建主体A并播种科目
  const subjectA = await prisma.taxpayerSubject.create({
    data: {
      name: '风险指标测试A公司',
      taxNumber: taxNumberA,
      taxpayerType: 'GENERAL',
      industry: '制造业',
      taxRate: 0.13,
      legalPerson: '测试A',
    },
  });
  const sidA = subjectA.id;
  const acctMapA = await seedAccounts(sidA);
  console.log(`  主体A已创建（id=${sidA}），科目数=${acctMapA.size}`);

  // --- 构造风险数据 ---
  console.log('\n  构造风险数据...');

  // 上一期(2026-06)：1张小额进项发票（使本期进项环比暴增 >50%）
  await createInvoice({
    subjectId: sidA,
    invoiceCode: '061',
    invoiceNo: '0001',
    direction: 'INPUT',
    billingDate: midDate(PREV),
    sellerName: '上期供应商A',
    buyerName: subjectA.name,
    sellerTaxNo: '910000000000001',
    buyerTaxNo: subjectA.taxNumber,
    amountExclTax: 10000,
    taxAmount: 1300,
    amountInclTax: 11300,
    taxRate: 0.13,
  });

  const curDate = midDate(CUR);

  // 本期(2026-07)：5张大额进项发票（每张不含税80000，税额10400，合计进项税52000）
  // 第1张卖家名称含"集团"关键字 → 关联交易
  for (let i = 1; i <= 5; i++) {
    await createInvoice({
      subjectId: sidA,
      invoiceCode: '071',
      invoiceNo: String(1000 + i),
      direction: 'INPUT',
      billingDate: curDate,
      sellerName: i === 1 ? '某某集团供应链有限公司' : `本期供应商${i}`,
      buyerName: subjectA.name,
      sellerTaxNo: `91000000000000${10 + i}`,
      buyerTaxNo: subjectA.taxNumber,
      amountExclTax: 80000,
      taxAmount: 10400,
      amountInclTax: 90400,
      taxRate: 0.13,
    });
  }

  // 1张小额销项发票（不含税5000，税额650）
  // → 进项52000远大于销项650+作废780=1430 → 税负率≈0 <1%（VAT_TAX_BURDEN HIGH）
  // → 留抵=(52000-1430)/52000≈97% >50%（EXCESS_CREDIT HIGH）
  await createInvoice({
    subjectId: sidA,
    invoiceCode: '072',
    invoiceNo: '2001',
    direction: 'OUTPUT',
    billingDate: curDate,
    sellerName: subjectA.name,
    buyerName: '客户甲',
    sellerTaxNo: subjectA.taxNumber,
    buyerTaxNo: '920000000000001',
    amountExclTax: 5000,
    taxAmount: 650,
    amountInclTax: 5650,
    taxRate: 0.13,
  });

  // 2张作废销项发票 → 作废率 2/8 = 25% > 10%（INVOICE_ABNORMAL HIGH）
  for (let i = 1; i <= 2; i++) {
    await createInvoice({
      subjectId: sidA,
      invoiceCode: '073',
      invoiceNo: String(3000 + i),
      direction: 'OUTPUT',
      billingDate: curDate,
      sellerName: subjectA.name,
      buyerName: `作废客户${i}`,
      sellerTaxNo: subjectA.taxNumber,
      buyerTaxNo: `92000000000000${i}`,
      amountExclTax: 3000,
      taxAmount: 390,
      amountInclTax: 3390,
      taxRate: 0.13,
      status: 'VOID',
    });
  }
  console.log('    发票：上期1张进项；本期5张大额进项(含1张关联方)+1张小额销项+2张作废销项');

  // 银行流水：资金回流（同对手方收入10万+支出9.9万，净额1000 < 总额5% → 资金走账）
  await prisma.bankTransaction.create({
    data: {
      subjectId: sidA,
      accountNo: '6222000000000001',
      transDate: curDate,
      amount: 100000,
      direction: 'IN',
      counterparty: '走账关联方乙',
      counterpartyAccount: '6222000000000002',
      summary: '货款收入',
    },
  });
  await prisma.bankTransaction.create({
    data: {
      subjectId: sidA,
      accountNo: '6222000000000001',
      transDate: curDate,
      amount: 99000,
      direction: 'OUT',
      counterparty: '走账关联方乙',
      counterpartyAccount: '6222000000000002',
      summary: '退款支出',
    },
  });
  console.log('    银行流水：对手方「走账关联方乙」收入10万+支出9.9万 → 资金回流');

  // 已过账凭证（用于 REVENUE_COST_MISMATCH 与 INVENTORY_MISMATCH）：
  // V1: 销售 借应收1130 / 贷收入1000 / 贷销项130 → 收入1000
  // V2: 采购 借库存5000 / 借进项650 / 贷应付5650 → 库存+5000
  // V3: 结转成本 借成本950 / 贷库存950 → 成本950，库存-950
  // 收入成本比 = 950/1000 = 0.95 > 0.9 → REVENUE_COST_MISMATCH HIGH
  // 库存账面变动 = 5000-950 = 4050 vs 进销差额389000 → 差异率≈0.99 > 0.3 → INVENTORY_MISMATCH HIGH
  const acct = (code: string) => acctMapA.get(code)!;
  await createPostedVoucher(sidA, '记-2026-07-001', curDate, '7月销售商品', [
    { accountId: acct('1122'), debit: 1130, credit: 0 }, // 应收账款
    { accountId: acct('6001'), debit: 0, credit: 1000 }, // 主营业务收入
    { accountId: acct('22210101'), debit: 0, credit: 130 }, // 销项税额
  ]);
  await createPostedVoucher(sidA, '记-2026-07-002', curDate, '7月采购商品', [
    { accountId: acct('1405'), debit: 5000, credit: 0 }, // 库存商品
    { accountId: acct('22210102'), debit: 650, credit: 0 }, // 进项税额
    { accountId: acct('2202'), debit: 0, credit: 5650 }, // 应付账款
  ]);
  await createPostedVoucher(sidA, '记-2026-07-003', curDate, '结转销售成本', [
    { accountId: acct('6401'), debit: 950, credit: 0 }, // 主营业务成本
    { accountId: acct('1405'), debit: 0, credit: 950 }, // 库存商品
  ]);
  console.log('    凭证：3张已过账（销售/采购/结转成本）→ 收入1000/成本950/库存变动4050');

  // 扫描主体A（本期 2026-07）
  console.log('\n  扫描主体A（period=2026-07）...');
  const summaryA = await scanSubject(sidA, undefined, CUR);
  console.log(`  扫描 ${summaryA.scanned} 个指标，命中 ${summaryA.hit} 个风险`);
  summaryA.events.forEach((e) =>
    console.log(`    - ${e.indicatorCode} | level=${e.level} | status=${e.status}`)
  );

  // 查询事件并验证各指标命中
  const eventsA = await prisma.riskEvent.findMany({
    where: { subjectId: sidA, period: CUR },
    include: { indicator: true },
  });
  const byCodeA = new Map(eventsA.map((e) => [e.indicator.code, e]));

  console.log('\n  验证指标命中：');

  // 1. VAT_TAX_BURDEN：税负率 = max(0, 销项1430-进项52000)/销售额11000 = 0 < 0.01 → HIGH
  const e1 = byCodeA.get('VAT_TAX_BURDEN');
  recordResult(
    'VAT_TAX_BURDEN', '增值税税负率异常',
    !!e1, e1?.level,
    e1 ? `税负率=${e1.metricValue}（销项1430-进项52000→0 / 销售额11000）` : '期望税负率<0.01命中HIGH'
  );

  // 2. INPUT_OUTPUT_MISMATCH：进项环比增长 = (52000-1300)/1300 ≈ 39倍 > 50% → HIGH
  const e2 = byCodeA.get('INPUT_OUTPUT_MISMATCH');
  recordResult(
    'INPUT_OUTPUT_MISMATCH', '进销项比对异常',
    !!e2, e2?.level,
    e2 ? `进项环比增长=${e2.metricValue}（上期1300→本期52000）` : '期望环比增长>50%命中HIGH'
  );

  // 3. REVENUE_COST_MISMATCH：成本率 = 950/1000 = 0.95 > 0.9 → HIGH
  const e3 = byCodeA.get('REVENUE_COST_MISMATCH');
  recordResult(
    'REVENUE_COST_MISMATCH', '收入成本匹配异常',
    !!e3, e3?.level,
    e3 ? `成本率=${e3.metricValue}（成本950/收入1000=0.95）` : '期望成本率>0.9命中HIGH'
  );

  // 4. INVOICE_ABNORMAL：作废率 = 2/8 = 25% > 10% → HIGH
  const e4 = byCodeA.get('INVOICE_ABNORMAL');
  recordResult(
    'INVOICE_ABNORMAL', '发票异常',
    !!e4, e4?.level,
    e4 ? `作废率25%（2/8）metric=${e4.metricValue}` : '期望作废率>10%命中HIGH'
  );

  // 5. INVENTORY_MISMATCH：差异率 = |389000-4050|/389000 ≈ 0.99 > 0.3 → HIGH
  const e5 = byCodeA.get('INVENTORY_MISMATCH');
  recordResult(
    'INVENTORY_MISMATCH', '库存账实不符',
    !!e5, e5?.level,
    e5 ? `差异率=${e5.metricValue}（进销差389000 vs 账面变动4050）` : '期望差异率>0.3命中HIGH'
  );

  // 6. FUND_FLOW_ABNORMAL：同对手方收入10万+支出9.9万，净额≈0 → HIGH
  const e6 = byCodeA.get('FUND_FLOW_ABNORMAL');
  recordResult(
    'FUND_FLOW_ABNORMAL', '资金流异常',
    !!e6, e6?.level,
    e6 ? `资金回流metric=${e6.metricValue}` : '期望检测到资金回流命中HIGH'
  );

  // 7. RELATED_TRANSACTION：卖家含"集团"关键字 → 命中（deviation=0.25>0.2 → MEDIUM）
  const e7 = byCodeA.get('RELATED_TRANSACTION');
  recordResult(
    'RELATED_TRANSACTION', '关联交易定价异常',
    !!e7, e7?.level,
    e7 ? `关联方「某某集团供应链有限公司」metric=${e7.metricValue}` : '期望命中关联方关键字'
  );

  // 9. EXCESS_CREDIT：留抵占比 = (52000-1430)/52000 ≈ 0.97 > 0.5 → HIGH
  const e9 = byCodeA.get('EXCESS_CREDIT');
  recordResult(
    'EXCESS_CREDIT', '期末留抵异常',
    !!e9, e9?.level,
    e9 ? `留抵占比=${e9.metricValue}（进项52000-销项1430→50570/52000）` : '期望留抵占比>50%命中HIGH'
  );

  // ===== 主体B：LONG_ZERO_FILING（长期零申报）=====
  console.log('\n[2] 准备主体B（覆盖 LONG_ZERO_FILING 长期零申报）');
  const taxNumberB = 'TEST-RI-B';
  await cleanupByTaxNumber(taxNumberB);
  console.log('  已清理旧主体B数据');

  const subjectB = await prisma.taxpayerSubject.create({
    data: {
      name: '风险指标测试B公司',
      taxNumber: taxNumberB,
      taxpayerType: 'GENERAL',
      industry: '服务业',
      taxRate: 0.06,
      legalPerson: '测试B',
    },
  });
  const sidB = subjectB.id;
  console.log(`  主体B已创建（id=${sidB}），不创建任何销项发票 → 连续零申报`);

  // 不创建任何发票/凭证 → 2026-05/06/07 均无销项 → 连续零申报 ≥ 3 期
  // 扫描主体B
  console.log('  扫描主体B（period=2026-07）...');
  const summaryB = await scanSubject(sidB, undefined, CUR);
  console.log(`  扫描 ${summaryB.scanned} 个指标，命中 ${summaryB.hit} 个风险`);
  summaryB.events.forEach((e) =>
    console.log(`    - ${e.indicatorCode} | level=${e.level} | status=${e.status}`)
  );

  const eventsB = await prisma.riskEvent.findMany({
    where: { subjectId: sidB, period: CUR },
    include: { indicator: true },
  });
  const byCodeB = new Map(eventsB.map((e) => [e.indicator.code, e]));

  console.log('\n  验证指标命中：');

  // 8. LONG_ZERO_FILING：连续 ≥3 期零申报 → HIGH
  const e8 = byCodeB.get('LONG_ZERO_FILING');
  recordResult(
    'LONG_ZERO_FILING', '长期零申报/微利申报',
    !!e8, e8?.level,
    e8 ? `连续零申报metric=${e8.metricValue}` : '期望连续≥3期零申报命中HIGH'
  );

  // ===== 汇总 =====
  console.log('\n========== 9类风险指标命中测试汇总 ==========');
  console.log('  指标编码                        | 名称               | 命中 | 等级');
  console.log('  --------------------------------|--------------------|-----|------');
  for (const r of results) {
    const code = r.code.padEnd(30);
    const name = r.name.padEnd(16);
    const hit = r.hit ? '✅' : '❌';
    const level = r.level ?? '-';
    console.log(`  ${code} | ${name} |  ${hit}  | ${level}`);
  }
  console.log(`\n  通过: ${passCount}/9  失败: ${failCount}/9`);
  if (failCount === 0) {
    console.log('  ✅ 全部9类风险指标命中测试通过');
  } else {
    console.log('  ❌ 存在未命中的指标，请检查风险扫描引擎实现');
  }
  console.log('\n========== Task9 风险指标命中测试完成 ==========');
}

main()
  .catch((err) => {
    console.error('\n❌ 测试执行异常:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
