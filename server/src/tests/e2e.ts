// Task9 集成验证：端到端业务闭环测试脚本（SubTask 9.1）
// 运行：npx ts-node --transpile-only src/tests/e2e.ts
//
// 完整业务闭环：
// 1. 登录获取 token（admin）
// 2. 创建一般纳税人主体 → 验证科目体系自动初始化（科目数≥40）
// 3. 上传发票数据（销项+进项）→ 验证去重
// 4. 录入凭证并过账（销售/采购/费用/结转成本）→ 验证借贷平衡、过账
// 5. 查询财务报表：资产负债表（balanced=true）、利润表、试算平衡表（借=贷）
// 6. 生成增值税申报表 → 验证应纳税额=销项-进项
// 7. 生成附加税 → 验证基于增值税额
// 8. 触发风险扫描 → 验证生成风险事件
// 9. 风险事件整改：创建整改任务→完成→事件自动 RESOLVED
// 10. 验证审计链完整：GET /api/audit/verify 返回 valid=true
import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import app from '../app';
import prisma from '../utils/prisma';
import bcrypt from 'bcryptjs';
import { GENERAL_TAXPAYER_ACCOUNTS } from '../seed/accounts';

// 测试端口（避免与开发端口冲突）
const TEST_PORT = 3098;
let server: http.Server;

// 测试所属期与关键日期
const PERIOD = '2026-07';
const VOUCHER_DATE = '2026-07-15';

// ============ HTTP 请求辅助 ============

// 通用 JSON 请求
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
        } else {
          data = buf.toString();
        }
        resolve({ status: res.statusCode || 0, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// 构造 multipart/form-data 请求体（用于文件上传）
function buildMultipart(fields: Array<{ name: string; value: string }>, file: { name: string; filename: string; contentType: string; content: Buffer }): Buffer {
  const boundary = '----E2ETestBoundary' + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  const crlf = '\r\n';
  // 普通字段
  for (const f of fields) {
    parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${f.name}"${crlf}${crlf}${f.value}${crlf}`));
  }
  // 文件字段
  parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"${crlf}Content-Type: ${file.contentType}${crlf}${crlf}`));
  parts.push(file.content);
  parts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));
  return Buffer.concat(parts);
}

// 上传文件（multipart）
async function uploadFile(
  path: string,
  token: string,
  fields: Array<{ name: string; value: string }>,
  file: { name: string; filename: string; contentType: string; content: Buffer }
): Promise<{ status: number; data: any }> {
  const body = buildMultipart(fields, file);
  const hdrs: Record<string, string> = {
    'Content-Type': `multipart/form-data; boundary=${body.toString('utf8', 0, 0).match(/----E2ETestBoundary[^\r\n]*/)?.[0] ?? '----E2ETestBoundary'}`,
    'Content-Length': body.length.toString(),
    Authorization: `Bearer ${token}`,
  };
  // 重新构造正确的 boundary header
  const boundaryMatch = body.toString('binary').match(/------E2ETestBoundary[^\r\n]*/);
  const boundary = boundaryMatch ? boundaryMatch[0].replace(/^--/, '') : '----E2ETestBoundary';
  hdrs['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
  const opts: http.RequestOptions = { method: 'POST', path, host: '127.0.0.1', port: TEST_PORT, headers: hdrs };
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
        } else {
          data = buf.toString();
        }
        resolve({ status: res.statusCode || 0, data });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============ 断言辅助 ============

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string) {
  if (!cond) {
    failCount++;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
    throw new Error(`断言失败: ${msg}`);
  }
  passCount++;
  console.log(`  ✅ ${msg}`);
}

function softAssert(cond: boolean, msg: string) {
  if (!cond) {
    failCount++;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
    return false;
  }
  passCount++;
  console.log(`  ✅ ${msg}`);
  return true;
}

// 构造发票 XML（销项 13% + 进项 13%，所属期 2026-07）
function buildInvoiceXml(): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<invoices>
  <invoice>
    <invoiceCode>440000E2E1</invoiceCode>
    <invoiceNo>00001001</invoiceNo>
    <invoiceType>SPECIAL</invoiceType>
    <direction>OUTPUT</direction>
    <billingDate>2026-07-10</billingDate>
    <buyerName>客户甲公司</buyerName>
    <sellerName>端到端测试科技有限公司</sellerName>
    <buyerTaxNo>91440000BUYER001</buyerTaxNo>
    <sellerTaxNo>91440000E2E00001</sellerTaxNo>
    <amountExclTax>10000</amountExclTax>
    <taxAmount>1300</taxAmount>
    <amountInclTax>11300</amountInclTax>
    <taxRate>0.13</taxRate>
  </invoice>
  <invoice>
    <invoiceCode>440000E2E2</invoiceCode>
    <invoiceNo>00002001</invoiceNo>
    <invoiceType>SPECIAL</invoiceType>
    <direction>INPUT</direction>
    <billingDate>2026-07-12</billingDate>
    <buyerName>端到端测试科技有限公司</buyerName>
    <sellerName>供应商乙公司</sellerName>
    <buyerTaxNo>91440000E2E00001</buyerTaxNo>
    <sellerTaxNo>91440000SELLER02</sellerTaxNo>
    <amountExclTax>5000</amountExclTax>
    <taxAmount>650</taxAmount>
    <amountInclTax>5650</amountInclTax>
    <taxRate>0.13</taxRate>
  </invoice>
</invoices>`;
  return Buffer.from(xml, 'utf8');
}

// ============ 主流程 ============

async function main() {
  console.log('========== Task9 端到端业务闭环测试 ==========\n');

  // 0. 确保 admin 用户存在
  const adminHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash: adminHash, role: 'ADMIN' },
  });

  // 清理历史测试主体数据（保证可重复运行）
  const taxNumber = 'TEST-E2E-001';
  const oldSubject = await prisma.taxpayerSubject.findUnique({ where: { taxNumber } });
  if (oldSubject) {
    await prisma.taxpayerSubject.delete({ where: { id: oldSubject.id } });
    console.log('已清理历史测试主体数据');
  }

  // 启动测试服务器
  await new Promise<void>((resolve) => {
    server = app.listen(TEST_PORT, () => resolve());
  });
  console.log(`测试服务器已启动: http://127.0.0.1:${TEST_PORT}\n`);

  try {
    // ===== 步骤1：登录获取 token =====
    console.log('--- 步骤1：登录获取 token（admin/admin123）---');
    const loginResp = await request('POST', '/api/auth/login', null, {
      username: 'admin',
      password: 'admin123',
    });
    assert(loginResp.status === 200, '管理员登录返回 200');
    const token = loginResp.data.token;
    assert(!!token, '登录返回 token');
    assert(loginResp.data.user.role === 'ADMIN', '登录用户角色为 ADMIN');

    // ===== 步骤2：创建一般纳税人主体 → 验证科目体系自动初始化 =====
    console.log('\n--- 步骤2：创建一般纳税人主体 → 验证科目体系自动初始化 ---');
    const createResp = await request('POST', '/api/taxpayers', token, {
      name: '端到端测试科技有限公司',
      taxNumber,
      taxpayerType: 'GENERAL',
      industry: '制造业',
      taxRate: 0.13,
      legalPerson: '测试法人',
    });
    assert(createResp.status === 201, '创建纳税人主体返回 201');
    const subjectId = createResp.data.id;
    const accountCount = createResp.data.accountCount;
    console.log(`  主体 id=${subjectId}, accountCount=${accountCount}`);
    assert(accountCount >= 40, `科目体系自动初始化，科目数≥40（实际 ${accountCount}）`);
    assert(createResp.data.taxpayerType === 'GENERAL', '主体类型为 GENERAL 一般纳税人');

    // 验证科目详情（含 accounts）
    const detailResp = await request('GET', `/api/taxpayers/${subjectId}`, token);
    assert(detailResp.status === 200, '主体详情查询返回 200');
    assert(detailResp.data.accounts.length >= 40, `主体详情含科目列表（${detailResp.data.accounts.length} 条）`);
    // 验证一般纳税人特有科目：销项税额/进项税额明细
    const hasOutputTax = detailResp.data.accounts.some((a: any) => a.code === '22210101');
    const hasInputTax = detailResp.data.accounts.some((a: any) => a.code === '22210102');
    assert(hasOutputTax, '一般纳税人科目含销项税额(22210101)');
    assert(hasInputTax, '一般纳税人科目含进项税额(22210102)');

    // ===== 步骤3：上传发票数据 → 验证去重 =====
    console.log('\n--- 步骤3：上传发票数据（销项+进项）→ 验证去重 ---');
    const invBuf = buildInvoiceXml();
    // 首次上传
    const up1 = await uploadFile('/api/imports/invoices', token, [{ name: 'subjectId', value: String(subjectId) }], {
      name: 'file',
      filename: 'e2e_invoices.xml',
      contentType: 'application/xml',
      content: invBuf,
    });
    assert(up1.status === 201, '首次发票上传返回 201');
    assert(up1.data.successCount === 2, `首次上传成功 2 条（实际 ${up1.data.successCount}）`);
    assert(up1.data.skippedCount === 0, `首次上传跳过 0 条（实际 ${up1.data.skippedCount}）`);
    // 重复上传（去重验证）
    const up2 = await uploadFile('/api/imports/invoices', token, [{ name: 'subjectId', value: String(subjectId) }], {
      name: 'file',
      filename: 'e2e_invoices_dup.xml',
      contentType: 'application/xml',
      content: invBuf,
    });
    assert(up2.status === 201, '重复发票上传返回 201');
    assert(up2.data.successCount === 0, `重复上传成功 0 条（去重，实际 ${up2.data.successCount}）`);
    assert(up2.data.skippedCount === 2, `重复上传跳过 2 条（去重，实际 ${up2.data.skippedCount}）`);

    // 等待发票导入触发的异步风险扫描完成（SQLite 单写锁，避免与后续凭证写入冲突）
    await new Promise((r) => setTimeout(r, 1200));

    // ===== 步骤4：录入凭证并过账 → 验证借贷平衡、过账 =====
    console.log('\n--- 步骤4：录入凭证并过账（销售/采购/费用/结转成本）---');
    // 获取科目 ID
    const findAcct = async (code: string) => {
      const r = await request('GET', `/api/taxpayers/${subjectId}/accounts`, token);
      const a = r.data.find((x: any) => x.code === code);
      if (!a) throw new Error(`科目 ${code} 不存在`);
      return a.id;
    };
    const acctResp = await request('GET', `/api/taxpayers/${subjectId}/accounts`, token);
    const acctMap = new Map<string, number>(acctResp.data.map((a: any) => [a.code, a.id]));
    const acct = {
      ar: acctMap.get('1122')!, // 应收账款
      ap: acctMap.get('2202')!, // 应付账款
      inv: acctMap.get('1405')!, // 库存商品
      cash: acctMap.get('1002')!, // 银行存款
      revenue: acctMap.get('6001')!, // 主营业务收入
      cost: acctMap.get('6401')!, // 主营业务成本
      outputTax: acctMap.get('22210101')!, // 销项税额
      inputTax: acctMap.get('22210102')!, // 进项税额
      adminExp: acctMap.get('6602')!, // 管理费用
    };

    // 验证借贷不平衡校验：构造借贷不平的凭证应被拒绝
    const badVoucher = await request('POST', '/api/vouchers', token, {
      subjectId,
      voucherDate: VOUCHER_DATE,
      summary: '借贷不平测试',
      entries: [
        { accountId: acct.ar, debit: 1000, credit: 0 },
        { accountId: acct.revenue, debit: 0, credit: 999 }, // 不平
      ],
    });
    assert(badVoucher.status === 400, '借贷不平凭证被拒绝（400）');

    // 凭证1：销售 借应收 11300 / 贷收入 10000 / 贷销项 1300
    const v1 = await request('POST', '/api/vouchers', token, {
      subjectId,
      voucherDate: VOUCHER_DATE,
      summary: '7月销售商品',
      entries: [
        { accountId: acct.ar, debit: 11300, credit: 0 },
        { accountId: acct.revenue, debit: 0, credit: 10000 },
        { accountId: acct.outputTax, debit: 0, credit: 1300 },
      ],
    });
    assert(v1.status === 201, '销售凭证创建返回 201');
    assert(v1.data.status === 'DRAFT', '凭证初始状态为 DRAFT');
    const v1Id = v1.data.id;
    const post1 = await request('POST', `/api/vouchers/${v1Id}/post`, token);
    assert(post1.status === 200, '销售凭证过账返回 200');
    assert(post1.data.status === 'POSTED', '销售凭证状态变为 POSTED');
    // 等待过账触发的异步风险扫描完成（SQLite 单写锁）
    await new Promise((r) => setTimeout(r, 500));

    // 凭证2：采购 借库存 5000 / 借进项 650 / 贷应付 5650
    const v2 = await request('POST', '/api/vouchers', token, {
      subjectId,
      voucherDate: VOUCHER_DATE,
      summary: '7月采购商品',
      entries: [
        { accountId: acct.inv, debit: 5000, credit: 0 },
        { accountId: acct.inputTax, debit: 650, credit: 0 },
        { accountId: acct.ap, debit: 0, credit: 5650 },
      ],
    });
    assert(v2.status === 201, '采购凭证创建返回 201');
    const post2 = await request('POST', `/api/vouchers/${v2.data.id}/post`, token);
    assert(post2.status === 200, '采购凭证过账返回 200');
    await new Promise((r) => setTimeout(r, 500));

    // 凭证3：结转成本 借主营业务成本 5000 / 贷库存商品 5000
    const v3 = await request('POST', '/api/vouchers', token, {
      subjectId,
      voucherDate: VOUCHER_DATE,
      summary: '结转销售成本',
      entries: [
        { accountId: acct.cost, debit: 5000, credit: 0 },
        { accountId: acct.inv, debit: 0, credit: 5000 },
      ],
    });
    assert(v3.status === 201, '结转成本凭证创建返回 201');
    const post3 = await request('POST', `/api/vouchers/${v3.data.id}/post`, token);
    assert(post3.status === 200, '结转成本凭证过账返回 200');
    await new Promise((r) => setTimeout(r, 500));

    // 凭证4：管理费用 借管理费用 1000 / 贷银行存款 1000
    const v4 = await request('POST', '/api/vouchers', token, {
      subjectId,
      voucherDate: VOUCHER_DATE,
      summary: '7月办公费',
      entries: [
        { accountId: acct.adminExp, debit: 1000, credit: 0 },
        { accountId: acct.cash, debit: 0, credit: 1000 },
      ],
    });
    assert(v4.status === 201, '管理费用凭证创建返回 201');
    const post4 = await request('POST', `/api/vouchers/${v4.data.id}/post`, token);
    assert(post4.status === 200, '管理费用凭证过账返回 200');
    // 等待最后一张凭证过账触发的异步风险扫描完成
    await new Promise((r) => setTimeout(r, 800));
    console.log('  已录入并过账 4 张凭证（销售/采购/成本/管理费用）');

    // ===== 步骤5：查询财务报表 → 验证平衡 =====
    console.log('\n--- 步骤5：查询财务报表（资产负债表/利润表/试算平衡表）---');
    // 资产负债表
    const bsResp = await request('GET', `/api/reports/balance-sheet?subjectId=${subjectId}&year=2026&period=7`, token);
    assert(bsResp.status === 200, '资产负债表查询返回 200');
    console.log(`  资产合计=${bsResp.data.totalAssets}, 负债合计=${bsResp.data.totalLiabilities}, 权益合计=${bsResp.data.totalEquity}`);
    assert(bsResp.data.balanced === true, '资产负债表平衡（资产=负债+权益）');
    // 验证：资产 10300 = 负债 6300 + 权益 4000
    softAssert(Math.abs(bsResp.data.totalAssets - 10300) < 0.01, `资产合计≈10300（实际 ${bsResp.data.totalAssets}）`);
    softAssert(Math.abs(bsResp.data.totalLiabilities - 6300) < 0.01, `负债合计≈6300（实际 ${bsResp.data.totalLiabilities}）`);
    softAssert(Math.abs(bsResp.data.totalEquity - 4000) < 0.01, `权益合计≈4000（实际 ${bsResp.data.totalEquity}）`);

    // 利润表
    const isResp = await request('GET', `/api/reports/income-statement?subjectId=${subjectId}&year=2026&period=7&rangeType=MONTH`, token);
    assert(isResp.status === 200, '利润表查询返回 200');
    console.log(`  营业收入=${isResp.data.operatingRevenue}, 营业成本=${isResp.data.operatingCost}, 利润总额=${isResp.data.totalProfit}`);
    softAssert(isResp.data.operatingRevenue === 10000, `营业收入=10000（实际 ${isResp.data.operatingRevenue}）`);
    softAssert(isResp.data.operatingCost === 5000, `营业成本=5000（实际 ${isResp.data.operatingCost}）`);
    softAssert(isResp.data.totalProfit === 4000, `利润总额=4000（实际 ${isResp.data.totalProfit}）`);

    // 试算平衡表
    const tbResp = await request('GET', `/api/reports/trial-balance?subjectId=${subjectId}&year=2026&period=7`, token);
    assert(tbResp.status === 200, '试算平衡表查询返回 200');
    console.log(`  本期借方合计=${tbResp.data.totalPeriodDebit}, 本期贷方合计=${tbResp.data.totalPeriodCredit}`);
    assert(tbResp.data.balanced === true, '试算平衡表平衡（借方合计=贷方合计）');
    softAssert(Math.abs(tbResp.data.totalPeriodDebit - 22950) < 0.01, `本期借方合计≈22950（实际 ${tbResp.data.totalPeriodDebit}）`);

    // ===== 步骤6：生成增值税申报表 → 验证应纳税额=销项-进项 =====
    console.log('\n--- 步骤6：生成增值税申报表 → 验证应纳税额=销项-进项 ---');
    const vatResp = await request('POST', '/api/tax-returns/generate', token, {
      subjectId,
      taxType: 'VAT',
      period: PERIOD,
    });
    assert(vatResp.status === 201, '增值税申报生成返回 201');
    const vatSummary = vatResp.data.reportData.summary;
    console.log(`  销项税额=${vatSummary.outputTax}, 进项税额=${vatSummary.inputTax}, 应纳税额=${vatSummary.taxAmount}`);
    assert(vatSummary.outputTax === 1300, '销项税额=1300');
    assert(vatSummary.inputTax === 650, '进项税额=650');
    assert(vatSummary.taxAmount === 650, '应纳税额=销项1300-进项650=650');
    assert(vatResp.data.status === 'DRAFT', '申报状态为 DRAFT');
    assert(vatResp.data.reportData.mainForm['应纳税额'] === 650, '主表应纳税额=650');

    // ===== 步骤7：生成附加税 → 验证基于增值税额 =====
    console.log('\n--- 步骤7：生成附加税申报 → 验证基于增值税额 ---');
    const surResp = await request('POST', '/api/tax-returns/generate', token, {
      subjectId,
      taxType: 'SURTAX',
      period: PERIOD,
      urbanRate: 0.07,
    });
    assert(surResp.status === 201, '附加税申报生成返回 201');
    const surReport = surResp.data.reportData;
    console.log(`  计税依据(增值税)=${surReport.vatPayable}, 城建税=${surReport.items[0].amount}, 合计=${surReport.total}`);
    assert(surReport.vatPayable === 650, '附加税计税依据=增值税额650');
    assert(surReport.items[0].amount === 45.5, '城建税=650×7%=45.5');
    assert(surReport.total === 78, '附加税合计=45.5+19.5+13=78');

    // ===== 步骤8：触发风险扫描 → 验证生成风险事件 =====
    console.log('\n--- 步骤8：触发风险扫描 → 验证生成风险事件 ---');
    // 凭证过账已自动触发扫描，这里手动触发一次确保扫描完成
    // 等待异步扫描完成
    await new Promise((r) => setTimeout(r, 500));
    const scanResp = await request('POST', '/api/risks/scan', token, {
      subjectId,
      period: PERIOD,
    });
    assert(scanResp.status === 200, '风险扫描接口返回 200');
    console.log(`  扫描 ${scanResp.data.scanned} 个指标，命中 ${scanResp.data.hit} 个风险`);
    scanResp.data.events.forEach((e: any) =>
      console.log(`    - ${e.indicatorCode} | level=${e.level} | status=${e.status}`)
    );
    assert(scanResp.data.hit >= 1, `风险扫描至少命中 1 个事件（实际 ${scanResp.data.hit}）`);

    // 查询风险事件列表
    const eventsResp = await request('GET', `/api/risks/events?subjectId=${subjectId}&pageSize=50`, token);
    assert(eventsResp.status === 200, '风险事件列表查询返回 200');
    assert(eventsResp.data.total >= 1, `风险事件列表至少 1 条（实际 ${eventsResp.data.total}）`);

    // ===== 步骤9：风险事件整改 → 事件自动 RESOLVED =====
    console.log('\n--- 步骤9：风险事件整改（创建整改任务→完成→事件自动 RESOLVED）---');
    // 取首个 PENDING 事件
    const pendingEvent = eventsResp.data.items.find((e: any) => e.status === 'PENDING');
    assert(!!pendingEvent, '存在 PENDING 状态风险事件');
    const eventId = pendingEvent.id;
    console.log(`  目标事件 #${eventId} (${pendingEvent.indicator.code}, level=${pendingEvent.level})`);

    // 获取可指派用户
    const usersResp = await request('GET', '/api/risks/users', token);
    assert(usersResp.status === 200, '可指派用户列表查询返回 200');
    const adminUser = usersResp.data.find((u: any) => u.username === 'admin');
    assert(!!adminUser, '可指派用户含 admin');

    // 创建整改任务
    const remResp = await request('POST', `/api/risks/events/${eventId}/remediations`, token, {
      assigneeId: adminUser.id,
      note: '核查进项发票真实性并补充资料',
    });
    assert(remResp.status === 201, '创建整改任务返回 201');
    assert(remResp.data.status === 'TODO', '整改任务初始状态为 TODO');
    const remId = remResp.data.id;

    // 验证事件状态变为 IN_PROGRESS
    const eventAfterCreate = await request('GET', `/api/risks/events/${eventId}`, token);
    assert(eventAfterCreate.data.status === 'IN_PROGRESS', '创建整改后事件状态变为 IN_PROGRESS');

    // 完成整改任务
    const doneResp = await request('PUT', `/api/risks/remediations/${remId}`, token, {
      status: 'DONE',
      note: '已核查完毕，进项发票真实有效',
    });
    assert(doneResp.status === 200, '整改任务标记 DONE 返回 200');
    assert(doneResp.data.status === 'DONE', '整改任务状态变为 DONE');

    // 验证事件自动 RESOLVED
    const eventAfterDone = await request('GET', `/api/risks/events/${eventId}`, token);
    assert(eventAfterDone.data.status === 'RESOLVED', '整改完成后事件自动 RESOLVED');
    assert(!!eventAfterDone.data.resolvedAt, '事件已记录 resolvedAt');
    assert(!!eventAfterDone.data.resolution, '事件已记录整改说明');

    // ===== 步骤10：验证审计链完整 =====
    console.log('\n--- 步骤10：验证审计链完整（GET /api/audit/verify）---');
    // 等待异步审计日志写入完成
    await new Promise((r) => setTimeout(r, 800));
    const verifyResp = await request('GET', '/api/audit/verify', token);
    assert(verifyResp.status === 200, '审计链校验接口返回 200');
    assert(verifyResp.data.valid === true, '审计链完整性校验通过（valid=true）');
    console.log(`  审计日志总数: ${verifyResp.data.total}`);
    assert(verifyResp.data.total >= 1, '审计日志已记录（total≥1）');

    // 验证审计日志含关键操作
    const auditListResp = await request('GET', '/api/audit?page=1&pageSize=100', token);
    assert(auditListResp.status === 200, '审计日志列表查询返回 200');
    const actions = new Set(auditListResp.data.items.map((a: any) => a.action));
    console.log(`  审计日志动作类型: ${[...actions].join(', ')}`);
    softAssert(actions.has('CREATE_TAXPAYER'), '审计日志含 CREATE_TAXPAYER');
    softAssert(actions.has('CREATE_VOUCHER'), '审计日志含 CREATE_VOUCHER');
    softAssert(actions.has('POST_VOUCHER'), '审计日志含 POST_VOUCHER');
    softAssert(actions.has('RISK_SCAN'), '审计日志含 RISK_SCAN');

    // ===== 汇总 =====
    console.log('\n========== 端到端测试汇总 ==========');
    console.log(`  通过: ${passCount}  失败: ${failCount}`);
    if (failCount === 0) {
      console.log('  ✅ 全部断言通过，端到端业务闭环验证成功');
    } else {
      console.log('  ❌ 存在失败项:');
      failures.forEach((f) => console.log(`     - ${f}`));
    }
    console.log('\n========== Task9 端到端测试完成 ==========');
    console.log('覆盖闭环：登录→建主体→传发票→录凭证过账→报表→申报→风险扫描→整改→审计校验');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
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
