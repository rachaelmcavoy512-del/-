// 财务报表模块端到端测试（Task4 验证）
// 运行：ts-node src/test-reports.ts
//
// 测试流程：
// 1. 准备一般纳税人主体（含科目体系）
// 2. 录入 4 张凭证（含增值税销项/进项）并过账
// 3. 通过 HTTP 调用 /api/reports 接口：
//    - 资产负债表 → 校验 资产 = 负债 + 所有者权益（balanced=true）
//    - 利润表 → 校验收入/成本/费用/净利润
//    - 现金流量表 → 校验经营/投资/筹资活动净额
//    - 试算平衡表 → 校验借方合计 = 贷方合计（balanced=true）
//    - 总账 / 明细账 → 校验余额与发生额
//    - refresh no-op 接口
import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import app from './app';
import prisma from './utils/prisma';
import bcrypt from 'bcryptjs';
import { GENERAL_TAXPAYER_ACCOUNTS } from './seed/accounts';
import { createVoucher, postVoucher } from './services/voucherService';

// 测试端口（避免与开发端口及其他测试冲突）
const TEST_PORT = 3097;
let server: http.Server;

// HTTP 请求辅助
async function request(
  method: string,
  path: string,
  token: string | null,
  body?: unknown
): Promise<{ status: number; data: any }> {
  const hdrs: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    hdrs['Content-Type'] = 'application/json';
    hdrs['Content-Length'] = Buffer.byteLength(payload).toString();
  }
  if (token) hdrs['Authorization'] = `Bearer ${token}`;
  const opts: http.RequestOptions = { method, path, host: '127.0.0.1', port: TEST_PORT, headers: hdrs };
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let data: any = null;
        const ct = res.headers['content-type'] || '';
        if (ct.includes('application/json') && buf.length) {
          data = JSON.parse(buf.toString());
        }
        resolve({ status: res.statusCode || 0, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// 断言辅助
function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`❌ 断言失败: ${msg}`);
  }
  console.log(`  ✅ ${msg}`);
}

// 浮点近似比较（2 位小数）
function approx(a: number, b: number, msg: string) {
  assert(Math.abs(a - b) < 0.01, `${msg}（实际 ${a}，期望 ${b}）`);
}

async function main() {
  console.log('=== Task4 财务报表模块端到端测试开始 ===\n');

  // 0. 确保 admin 用户存在
  const adminHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash: adminHash, role: 'ADMIN' },
  });

  // 创建/复用测试主体（一般纳税人），并初始化科目体系
  const taxNumber = 'TEST_REPORT_001';
  let subject = await prisma.taxpayerSubject.findUnique({ where: { taxNumber } });
  if (!subject) {
    subject = await prisma.taxpayerSubject.create({
      data: {
        name: '财务报表测试主体',
        taxNumber,
        taxpayerType: 'GENERAL',
        taxRate: 0.13,
      },
    });
    await prisma.account.createMany({
      data: GENERAL_TAXPAYER_ACCOUNTS.map((a) => ({
        subjectId: subject!.id,
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
    console.log(`已创建测试主体: id=${subject.id}, name=${subject.name}`);
  } else {
    console.log(`复用已有测试主体: id=${subject.id}, name=${subject.name}`);
  }
  const subjectId = subject.id;

  // 清理历史凭证，确保测试可重复
  await prisma.voucherEntry.deleteMany({ where: { voucher: { subjectId } } });
  await prisma.voucher.deleteMany({ where: { subjectId } });
  console.log('已清理历史凭证数据');

  // 1. 获取科目 ID
  const findAcct = async (code: string) => {
    const a = await prisma.account.findFirst({ where: { subjectId, code } });
    if (!a) throw new Error(`科目 ${code} 不存在`);
    return a.id;
  };
  const acct = {
    cash: await findAcct('1002'), // 银行存款
    ar: await findAcct('1122'), // 应收账款
    inv: await findAcct('1405'), // 库存商品
    ap: await findAcct('2202'), // 应付账款
    capital: await findAcct('4001'), // 实收资本
    revenue: await findAcct('6001'), // 主营业务收入
    outputTax: await findAcct('22210101'), // 销项税额
    inputTax: await findAcct('22210102'), // 进项税额
    adminExp: await findAcct('6602'), // 管理费用
  };

  // 2. 录入 4 张凭证并过账（2026-06）
  // 凭证1：股东注资 借银行存款 100000 / 贷实收资本 100000
  const v1 = await createVoucher(
    subjectId,
    {
      voucherDate: '2026-06-05',
      summary: '股东注资',
      entries: [
        { accountId: acct.cash, debit: 100000, credit: 0 },
        { accountId: acct.capital, debit: 0, credit: 100000 },
      ],
    },
    admin.id
  );
  await postVoucher(v1.id, admin.id);

  // 凭证2：销售 借应收账款 11300 / 贷主营业务收入 10000 / 贷销项税额 1300
  const v2 = await createVoucher(
    subjectId,
    {
      voucherDate: '2026-06-10',
      summary: '6月销售商品',
      entries: [
        { accountId: acct.ar, debit: 11300, credit: 0 },
        { accountId: acct.revenue, debit: 0, credit: 10000 },
        { accountId: acct.outputTax, debit: 0, credit: 1300 },
      ],
    },
    admin.id
  );
  await postVoucher(v2.id, admin.id);

  // 凭证3：采购 借库存商品 5000 / 借进项税额 650 / 贷应付账款 5650
  const v3 = await createVoucher(
    subjectId,
    {
      voucherDate: '2026-06-12',
      summary: '6月采购商品',
      entries: [
        { accountId: acct.inv, debit: 5000, credit: 0 },
        { accountId: acct.inputTax, debit: 650, credit: 0 },
        { accountId: acct.ap, debit: 0, credit: 5650 },
      ],
    },
    admin.id
  );
  await postVoucher(v3.id, admin.id);

  // 凭证4：支付办公费 借管理费用 1000 / 贷银行存款 1000
  const v4 = await createVoucher(
    subjectId,
    {
      voucherDate: '2026-06-18',
      summary: '6月办公费',
      entries: [
        { accountId: acct.adminExp, debit: 1000, credit: 0 },
        { accountId: acct.cash, debit: 0, credit: 1000 },
      ],
    },
    admin.id
  );
  await postVoucher(v4.id, admin.id);
  console.log('已录入并过账4张凭证（注资/销售/采购/办公费）');

  // 3. 启动测试服务器
  await new Promise<void>((resolve) => {
    server = app.listen(TEST_PORT, () => resolve());
  });
  console.log(`\n测试服务器已启动: http://127.0.0.1:${TEST_PORT}`);

  // 登录获取 token
  const loginResp = await request('POST', '/api/auth/login', null, {
    username: 'admin',
    password: 'admin123',
  });
  assert(loginResp.status === 200, '管理员登录成功');
  const token = loginResp.data.token;

  try {
    // ===== 测试1：资产负债表（核心：资产 = 负债 + 所有者权益）=====
    console.log('\n--- 测试1：资产负债表（2026-06，校验平衡）---');
    const bsResp = await request(
      'GET',
      `/api/reports/balance-sheet?subjectId=${subjectId}&year=2026&period=6`,
      token
    );
    assert(bsResp.status === 200, `资产负债表接口返回 200（实际 ${bsResp.status}）`);
    const bs = bsResp.data;
    console.log(
      `  资产合计=${bs.totalAssets}, 负债合计=${bs.totalLiabilities}, 所有者权益合计=${bs.totalEquity}, 负债+权益=${bs.totalLiabilities + bs.totalEquity}`
    );
    // 资产：银行存款 99000 + 应收 11300 + 库存 5000 = 115300
    approx(bs.totalAssets, 115300, '资产合计 = 115300（银行99000+应收11300+库存5000）');
    // 负债：销项 1300 + 进项(-650) + 应付 5650 = 6300（进项为备抵，负数抵减）
    approx(bs.totalLiabilities, 6300, '负债合计 = 6300（销项1300-进项650+应付5650）');
    // 权益：实收资本 100000 + 未分配利润(本年净利润 9000) = 109000
    approx(bs.totalEquity, 109000, '所有者权益合计 = 109000（实收资本100000+净利润9000）');
    assert(bs.balanced === true, '资产负债表平衡：资产 = 负债 + 所有者权益 ✅');

    // ===== 测试2：利润表（MONTH）=====
    console.log('\n--- 测试2：利润表（2026-06 单月）---');
    const isResp = await request(
      'GET',
      `/api/reports/income-statement?subjectId=${subjectId}&year=2026&period=6&rangeType=MONTH`,
      token
    );
    assert(isResp.status === 200, `利润表接口返回 200（实际 ${isResp.status}）`);
    const is = isResp.data;
    console.log(
      `  营业收入=${is.operatingRevenue}, 营业成本=${is.operatingCost}, 期间费用=${is.periodExpenses}, 营业利润=${is.operatingProfit}, 利润总额=${is.totalProfit}, 净利润=${is.netProfit}`
    );
    approx(is.operatingRevenue, 10000, '营业收入 = 10000');
    approx(is.operatingCost, 0, '营业成本 = 0（未结转销售成本）');
    approx(is.periodExpenses, 1000, '期间费用 = 1000（管理费用）');
    approx(is.operatingProfit, 9000, '营业利润 = 10000 - 0 - 1000 = 9000');
    approx(is.totalProfit, 9000, '利润总额 = 9000（无非营业项目）');
    approx(is.netProfit, 9000, '净利润 = 9000（无所得税）');

    // ===== 测试3：现金流量表（MONTH）=====
    console.log('\n--- 测试3：现金流量表（2026-06 单月）---');
    const cfResp = await request(
      'GET',
      `/api/reports/cash-flow-statement?subjectId=${subjectId}&year=2026&period=6&rangeType=MONTH`,
      token
    );
    assert(cfResp.status === 200, `现金流量表接口返回 200（实际 ${cfResp.status}）`);
    const cf = cfResp.data;
    console.log(
      `  经营：流入=${cf.operating.inflow} 流出=${cf.operating.outflow} 净额=${cf.operating.net}; 投资：净额=${cf.investing.net}; 筹资：流入=${cf.financing.inflow} 流出=${cf.financing.outflow} 净额=${cf.financing.net}; 现金净增加=${cf.netChange}`
    );
    // 经营活动：支付办公费流出 1000，净额 -1000
    approx(cf.operating.outflow, 1000, '经营活动现金流出 = 1000（支付办公费）');
    approx(cf.operating.net, -1000, '经营活动净额 = -1000');
    // 筹资活动：股东注资流入 100000，净额 100000
    approx(cf.financing.inflow, 100000, '筹资活动现金流入 = 100000（股东注资）');
    approx(cf.financing.net, 100000, '筹资活动净额 = 100000');
    // 现金净增加 = -1000 + 0 + 100000 = 99000（与银行存款期末余额变动一致）
    approx(cf.netChange, 99000, '现金净增加 = 99000（= 银行存款期末 99000 - 期初 0）');
    approx(cf.operating.net + cf.investing.net + cf.financing.net, cf.netChange, '三大活动净额之和 = 现金净增加');

    // ===== 测试4：试算平衡表（校验借方合计 = 贷方合计）=====
    console.log('\n--- 测试4：试算平衡表（2026-06，校验平衡）---');
    const tbResp = await request(
      'GET',
      `/api/reports/trial-balance?subjectId=${subjectId}&year=2026&period=6`,
      token
    );
    assert(tbResp.status === 200, `试算平衡表接口返回 200（实际 ${tbResp.status}）`);
    const tb = tbResp.data;
    console.log(
      `  本期借方合计=${tb.totalPeriodDebit}, 本期贷方合计=${tb.totalPeriodCredit}`
    );
    // 本期借方 = 100000+11300+5000+650+1000 = 117950
    approx(tb.totalPeriodDebit, 117950, '本期借方合计 = 117950');
    approx(tb.totalPeriodCredit, 117950, '本期贷方合计 = 117950');
    assert(tb.balanced === true, '试算平衡：本期借方合计 = 贷方合计 ✅');

    // ===== 测试5：总账（银行存款 1002，MONTH）=====
    console.log('\n--- 测试5：总账（银行存款 1002，2026-06）---');
    const glResp = await request(
      'GET',
      `/api/reports/general-ledger?subjectId=${subjectId}&accountId=${acct.cash}&year=2026&period=6&rangeType=MONTH`,
      token
    );
    assert(glResp.status === 200, `总账接口返回 200（实际 ${glResp.status}）`);
    const gl = glResp.data;
    console.log(
      `  科目=${gl.account.code} ${gl.account.name}, 期初=${gl.openingBalance}, 借方合计=${gl.totalDebit}, 贷方合计=${gl.totalCredit}, 期末=${gl.closingBalance}`
    );
    approx(gl.openingBalance, 0, '银行存款期初余额 = 0');
    approx(gl.totalDebit, 100000, '银行存款本期借方合计 = 100000（注资）');
    approx(gl.totalCredit, 1000, '银行存款本期贷方合计 = 1000（支付办公费）');
    approx(gl.closingBalance, 99000, '银行存款期末余额 = 99000');

    // ===== 测试6：明细账（银行存款 1002，6月）=====
    console.log('\n--- 测试6：明细账（银行存款 1002，2026-06-01 ~ 2026-06-30）---');
    const slResp = await request(
      'GET',
      `/api/reports/subsidiary-ledger?subjectId=${subjectId}&accountId=${acct.cash}&from=2026-06-01&to=2026-06-30`,
      token
    );
    assert(slResp.status === 200, `明细账接口返回 200（实际 ${slResp.status}）`);
    const sl = slResp.data;
    console.log(
      `  科目=${sl.account.code} ${sl.account.name}, 期初=${sl.openingBalance}, 凭证笔数=${sl.entries.length}, 借方合计=${sl.totalDebit}, 贷方合计=${sl.totalCredit}, 期末=${sl.closingBalance}`
    );
    assert(sl.entries.length === 2, `明细账含 2 笔分录（实际 ${sl.entries.length}）`);
    approx(sl.openingBalance, 0, '明细账期初余额 = 0');
    approx(sl.totalDebit, 100000, '明细账借方合计 = 100000');
    approx(sl.totalCredit, 1000, '明细账贷方合计 = 1000');
    approx(sl.closingBalance, 99000, '明细账期末余额 = 99000');
    // 第一笔：注资 借 100000，余额 100000
    approx(sl.entries[0].debit, 100000, '第一笔（注资）借方 = 100000');
    approx(sl.entries[0].balance, 100000, '第一笔余额 = 100000');
    // 第二笔：办公费 贷 1000，余额 99000
    approx(sl.entries[1].credit, 1000, '第二笔（办公费）贷方 = 1000');
    approx(sl.entries[1].balance, 99000, '第二笔余额 = 99000');

    // ===== 测试7：refresh no-op 接口 =====
    console.log('\n--- 测试7：refresh no-op 接口 ---');
    const rfResp = await request('GET', '/api/reports/refresh', token);
    assert(rfResp.status === 200, 'refresh 接口返回 200');
    assert(rfResp.data.ok === true, 'refresh 返回 ok=true');

    // ===== 测试8：利润表 YEAR 范围（本年累计）=====
    console.log('\n--- 测试8：利润表（2026 年度截至 6 月，本年累计）---');
    const isYearResp = await request(
      'GET',
      `/api/reports/income-statement?subjectId=${subjectId}&year=2026&period=6&rangeType=YEAR`,
      token
    );
    assert(isYearResp.status === 200, `利润表(YEAR)接口返回 200（实际 ${isYearResp.status}）`);
    approx(isYearResp.data.netProfit, 9000, '本年累计净利润 = 9000（与单月一致，因仅6月有业务）');

    console.log('\n=== Task4 财务报表模块端到端测试全部通过 ✅ ===');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main()
  .catch((err) => {
    console.error('\n❌ 测试失败:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
