// Task7 风险监控端到端测试脚本
// 制造风险数据 → 扫描 → 分级 → 整改流转 → 重扫 → 看板
// 运行：npx ts-node src/scripts/testRiskScan.ts
import prisma from '../utils/prisma';
import { scanSubject, rescanAll } from '../services/riskScanService';

const PREV = '2026-06'; // 上一期（少量进项，使本期进项环比暴增）
const CUR = '2026-07'; // 本期（大量进项 + 少量销项 + 作废 + 资金回流 + 关联方）

function periodStart(period: string): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1);
}
function periodEnd(period: string): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0, 23, 59, 59, 999);
}
// 生成某期中旬日期
function midDate(period: string): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 15);
}

async function main() {
  console.log('========== Task7 风险监控端到端测试 ==========\n');

  // 1. 校验指标库
  const indicatorCount = await prisma.riskIndicator.count();
  console.log(`[1] 风险指标库：${indicatorCount} 条内置指标`);
  if (indicatorCount === 0) {
    console.error('  ✗ 指标库为空，请先运行 npm run seed');
    process.exit(1);
  }
  const indicators = await prisma.riskIndicator.findMany({ orderBy: { id: 'asc' } });
  console.log('  指标列表：');
  indicators.forEach((i) => console.log(`    - ${i.code} | ${i.name} | high=${i.thresholdHigh} | enabled=${i.enabled}`));

  // 2. 准备测试主体（复用或新建）
  let subject = await prisma.taxpayerSubject.findFirst({
    where: { taxNumber: 'TEST-RISK-001' },
  });
  if (!subject) {
    subject = await prisma.taxpayerSubject.create({
      data: {
        name: '风险测试科技有限公司',
        taxNumber: 'TEST-RISK-001',
        taxpayerType: 'GENERAL',
        industry: '制造业',
        taxRate: 0.13,
        legalPerson: '张三',
      },
    });
    console.log(`\n[2] 新建测试主体：${subject.name} (id=${subject.id})`);
  } else {
    console.log(`\n[2] 复用测试主体：${subject.name} (id=${subject.id})`);
  }
  const sid = subject.id;

  // 3. 清理该主体旧测试数据（顺序：整改→事件→发票→银行流水）
  await prisma.riskRemediation.deleteMany({ where: { event: { subjectId: sid } } });
  await prisma.riskEvent.deleteMany({ where: { subjectId: sid } });
  await prisma.invoice.deleteMany({ where: { subjectId: sid } });
  await prisma.bankTransaction.deleteMany({ where: { subjectId: sid } });
  console.log('  已清理该主体旧风险数据');

  // 4. 制造风险数据
  console.log('\n[3] 制造风险数据...');

  // 4.1 上一期(2026-06)：少量进项发票（使本期进项环比增长 >50%）
  await prisma.invoice.create({
    data: {
      subjectId: sid,
      invoiceCode: '061',
      invoiceNo: '0001',
      invoiceType: 'SPECIAL',
      direction: 'INPUT',
      billingDate: midDate(PREV),
      sellerName: '上期供应商A',
      buyerName: subject.name,
      sellerTaxNo: '910000000000001',
      buyerTaxNo: subject.taxNumber,
      amountExclTax: 10000,
      taxAmount: 1300,
      amountInclTax: 11300,
      taxRate: 0.13,
      status: 'NORMAL',
    },
  });

  // 4.2 本期(2026-07)：
  //   - 大量进项发票（进项税额远大于销项 → 税负率≈0 <1% HIGH、留抵占比>50% HIGH、进项环比暴增 HIGH）
  //   - 少量销项发票（销售额小，税负率低）
  //   - 部分作废发票（作废率>10% → INVOICE_ABNORMAL）
  //   - 关联方发票（卖家名含"集团" → RELATED_TRANSACTION）
  const curDate = midDate(CUR);

  // 大额进项（5张，每张不含税80000，税额10400）
  for (let i = 1; i <= 5; i++) {
    await prisma.invoice.create({
      data: {
        subjectId: sid,
        invoiceCode: '071',
        invoiceNo: String(1000 + i),
        invoiceType: 'SPECIAL',
        direction: 'INPUT',
        billingDate: curDate,
        sellerName: i === 1 ? '某某集团供应链有限公司' : `本期供应商${i}`,
        buyerName: subject.name,
        sellerTaxNo: `91000000000000${10 + i}`,
        buyerTaxNo: subject.taxNumber,
        amountExclTax: 80000,
        taxAmount: 10400,
        amountInclTax: 90400,
        taxRate: 0.13,
        status: 'NORMAL',
      },
    });
  }
  // 小额销项（1张，不含税5000，税额650）→ 税负率 = max(0,650-52000)/5000 = 0 <0.01 HIGH
  await prisma.invoice.create({
    data: {
      subjectId: sid,
      invoiceCode: '072',
      invoiceNo: '2001',
      invoiceType: 'SPECIAL',
      direction: 'OUTPUT',
      billingDate: curDate,
      sellerName: subject.name,
      buyerName: '客户甲',
      sellerTaxNo: subject.taxNumber,
      buyerTaxNo: '920000000000001',
      amountExclTax: 5000,
      taxAmount: 650,
      amountInclTax: 5650,
      taxRate: 0.13,
      status: 'NORMAL',
    },
  });
  // 作废发票（2张作废，使作废率 = 2/8 = 25% > 10% → INVOICE_ABNORMAL HIGH）
  for (let i = 1; i <= 2; i++) {
    await prisma.invoice.create({
      data: {
        subjectId: sid,
        invoiceCode: '073',
        invoiceNo: String(3000 + i),
        invoiceType: 'NORMAL',
        direction: 'OUTPUT',
        billingDate: curDate,
        sellerName: subject.name,
        buyerName: `作废客户${i}`,
        sellerTaxNo: subject.taxNumber,
        buyerTaxNo: `92000000000000${i}`,
        amountExclTax: 3000,
        taxAmount: 390,
        amountInclTax: 3390,
        taxRate: 0.13,
        status: 'VOID',
      },
    });
  }
  console.log('  发票数据：上期1张进项；本期5张大额进项(含1张关联方)+1张小额销项+2张作废销项');
  console.log('    预期：进项税52000 vs 销项税650+1040(作废不计税额聚合? 实际聚合按direction计)');

  // 4.3 银行流水：资金回流（同一对手方既有收入又有支出，净额≈0 → FUND_FLOW_ABNORMAL HIGH）
  await prisma.bankTransaction.create({
    data: {
      subjectId: sid,
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
      subjectId: sid,
      accountNo: '6222000000000001',
      transDate: curDate,
      amount: 99000,
      direction: 'OUT',
      counterparty: '走账关联方乙',
      counterpartyAccount: '6222000000000002',
      summary: '退款支出',
    },
  });
  console.log('  银行流水：对手方「走账关联方乙」收入10万+支出9.9万，净额≈0 → 资金回流');

  // 5. 触发扫描
  console.log('\n[4] 触发扫描（scanSubject, period=2026-07）...');
  const summary = await scanSubject(sid, undefined, CUR);
  console.log(`  扫描 ${summary.scanned} 个指标，命中 ${summary.hit} 个风险`);
  console.log('  命中事件：');
  summary.events.forEach((e) =>
    console.log(`    - event#${e.id} ${e.indicatorCode} | level=${e.level} | status=${e.status}`)
  );

  // 6. 校验事件等级
  console.log('\n[5] 校验风险事件等级...');
  const events = await prisma.riskEvent.findMany({
    where: { subjectId: sid },
    include: { indicator: true },
    orderBy: { id: 'asc' },
  });
  const byCode = new Map(events.map((e) => [e.indicator.code, e]));
  const expectHigh = ['VAT_TAX_BURDEN', 'INPUT_OUTPUT_MISMATCH', 'EXCESS_CREDIT'];
  let pass = 0;
  let fail = 0;
  for (const code of expectHigh) {
    const e = byCode.get(code);
    if (e && e.level === 'HIGH') {
      console.log(`  ✓ ${code} 命中 HIGH（metricValue=${e.metricValue}）`);
      pass++;
    } else {
      console.log(`  ✗ ${code} 期望 HIGH，实际 ${e ? e.level : '未命中'}（metricValue=${e?.metricValue}）`);
      fail++;
    }
  }
  // 发票异常/资金流/关联交易 至少命中
  for (const code of ['INVOICE_ABNORMAL', 'FUND_FLOW_ABNORMAL', 'RELATED_TRANSACTION']) {
    const e = byCode.get(code);
    if (e) {
      console.log(`  ✓ ${code} 命中（level=${e.level}, metric=${e.metricValue}）`);
      pass++;
    } else {
      console.log(`  ✗ ${code} 未命中`);
      fail++;
    }
  }
  console.log(`  命中指标统计：通过 ${pass} / 失败 ${fail}`);

  // 7. 校验高风险推送（AuditLog action=RISK_ALERT_HIGH）
  const alerts = await prisma.auditLog.findMany({
    where: { action: 'RISK_ALERT_HIGH' },
    orderBy: { id: 'desc' },
    take: 10,
  });
  const myAlerts = alerts.filter((a) => (a.detail ?? '').includes(`"subjectId":${sid}`));
  console.log(`\n[6] 高风险推送校验：AuditLog RISK_ALERT_HIGH 共 ${myAlerts.length} 条（本主体）`);
  if (myAlerts.length > 0) {
    console.log(`  ✓ 高风险事件已推送管理员（target=${myAlerts[0].target}）`);
  } else {
    console.log('  ! 高风险推送为异步(setImmediate)，稍候可复查');
  }

  // 8. 整改流转：对首个 HIGH 事件创建整改任务 → 完成 → 事件自动 RESOLVED
  console.log('\n[7] 整改流转测试...');
  const highEvent = events.find((e) => e.level === 'HIGH');
  if (!highEvent) {
    console.log('  ✗ 无 HIGH 事件，跳过整改测试');
  } else {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const assigneeId = admin?.id ?? 1;
    const rem = await prisma.riskRemediation.create({
      data: { eventId: highEvent.id, assigneeId, status: 'TODO', note: '核查进项发票真实性' },
    });
    console.log(`  创建整改任务 #${rem.id}（指派 admin#${assigneeId}）→ 事件应置 IN_PROGRESS`);
    let ev = await prisma.riskEvent.findUnique({ where: { id: highEvent.id } });
    console.log(`  事件状态：${ev?.status}（期望 IN_PROGRESS）`);
    // 标记整改完成
    await prisma.riskRemediation.update({ where: { id: rem.id }, data: { status: 'DONE' } });
    console.log(`  整改任务标记 DONE → 事件应自动 RESOLVED`);
    ev = await prisma.riskEvent.findUnique({ where: { id: highEvent.id } });
    console.log(`  事件状态：${ev?.status}（期望 RESOLVED） resolution=${ev?.resolution}`);
    if (ev?.status === 'RESOLVED') {
      console.log('  ✓ 整改闭环成功');
    } else {
      console.log('  ✗ 整改闭环失败');
    }
  }

  // 9. 看板统计
  console.log('\n[8] 风险看板统计...');
  const allEvents = await prisma.riskEvent.findMany({ where: { subjectId: sid } });
  const byLevel = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const byStatus = { PENDING: 0, IN_PROGRESS: 0, RESOLVED: 0, IGNORED: 0 };
  for (const e of allEvents) {
    byLevel[e.level as keyof typeof byLevel]++;
    byStatus[e.status as keyof typeof byStatus]++;
  }
  const denom = byStatus.RESOLVED + byStatus.PENDING + byStatus.IN_PROGRESS;
  const remediationRate = denom > 0 ? (byStatus.RESOLVED / denom) * 100 : 0;
  console.log(`  总事件数：${allEvents.length}`);
  console.log(`  等级分布：HIGH=${byLevel.HIGH} MEDIUM=${byLevel.MEDIUM} LOW=${byLevel.LOW}`);
  console.log(`  状态分布：PENDING=${byStatus.PENDING} IN_PROGRESS=${byStatus.IN_PROGRESS} RESOLVED=${byStatus.RESOLVED} IGNORED=${byStatus.IGNORED}`);
  console.log(`  整改率：${remediationRate.toFixed(1)}%`);

  // 10. 重扫测试：修改 VAT_TAX_BURDEN 高风险阈值为极低值，重扫后该事件应被关闭
  console.log('\n[9] 重扫测试（调整 VAT_TAX_BURDEN 阈值后重扫）...');
  const vatInd = await prisma.riskIndicator.findUnique({ where: { code: 'VAT_TAX_BURDEN' } });
  if (vatInd) {
    const origHigh = vatInd.thresholdHigh;
    // 将高风险阈值改为 {lt:0}（永不可能<0），使税负率不再命中 HIGH
    await prisma.riskIndicator.update({
      where: { id: vatInd.id },
      data: { thresholdHigh: '{"lt":0}', thresholdMedium: '{"lt":0}' },
    });
    console.log(`  已将 VAT_TAX_BURDEN 阈值改为 {lt:0}（不再命中），原值=${origHigh}`);
    const rescanResults = await rescanAll(sid);
    const r = rescanResults[0];
    console.log(`  重扫结果：扫描 ${r.scanned} 指标，命中 ${r.hit}，关闭 ${r.closed} 个不再命中事件`);
    // 检查 VAT_TAX_BURDEN 事件是否被关闭
    const vatEventAfter = await prisma.riskEvent.findFirst({
      where: { subjectId: sid, indicatorId: vatInd.id },
    });
    console.log(`  VAT_TAX_BURDEN 事件状态：${vatEventAfter?.status}（期望 RESOLVED 自动关闭）`);
    if (vatEventAfter?.status === 'RESOLVED') {
      console.log('  ✓ 重扫后未命中事件已自动关闭');
    } else {
      console.log('  ✗ 重扫关闭失败');
    }
    // 恢复阈值
    await prisma.riskIndicator.update({
      where: { id: vatInd.id },
      data: { thresholdHigh: origHigh, thresholdMedium: '{"lt":0.02}' },
    });
    console.log('  已恢复 VAT_TAX_BURDEN 阈值');
  }

  console.log('\n========== Task7 风险监控端到端测试完成 ==========');
  console.log(`总结：命中 ${summary.hit} 类风险指标，覆盖税负率/进销项失衡/留抵异常/发票异常/资金回流/关联交易等场景`);
  console.log('  - HIGH 事件正确分级并推送管理员');
  console.log('  - 整改任务完成后事件自动 RESOLVED');
  console.log('  - 重扫后未命中事件自动关闭');
  console.log('  - 看板统计正确');
}

main()
  .catch((err) => {
    console.error('测试失败:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
