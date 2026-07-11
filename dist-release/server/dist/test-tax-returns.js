"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// 税务申报模块端到端测试（Task6 验证）
// 运行：ts-node src/test-tax-returns.ts
//
// 测试流程：
// 1. 准备一般纳税人主体（含科目体系）
// 2. 导入发票（销项+进项）via importService
// 3. 录入收入/成本/费用凭证并过账 via voucherService
// 4. 通过 HTTP 调用 /api/tax-returns 接口：
//    - 生成增值税申报 → 应纳税额 = 销项 - 进项
//    - 生成附加税 → 基于增值税额
//    - 生成企业所得税（季度）→ 基于利润
//    - 状态流转 DRAFT→PENDING→FILED→PAID
//    - 导出 Excel
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const http_1 = __importDefault(require("http"));
const app_1 = __importDefault(require("./app"));
const prisma_1 = __importDefault(require("./utils/prisma"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const accounts_1 = require("./seed/accounts");
const importService_1 = require("./services/importService");
const voucherService_1 = require("./services/voucherService");
// 测试端口（避免与开发端口冲突）
const TEST_PORT = 3099;
let server;
// 构造发票 XML（销项 13% + 进项 13%，所属期 2026-06）
function buildInvoiceXml() {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<invoices>
  <invoice>
    <invoiceCode>3300009999</invoiceCode>
    <invoiceNo>00001001</invoiceNo>
    <invoiceType>SPECIAL</invoiceType>
    <direction>OUTPUT</direction>
    <billingDate>2026-06-10</billingDate>
    <buyerName>客户甲公司</buyerName>
    <sellerName>测试一般纳税人有限公司</sellerName>
    <buyerTaxNo>91330000BUYER001</buyerTaxNo>
    <sellerTaxNo>91330000GENERAL01</sellerTaxNo>
    <amountExclTax>10000</amountExclTax>
    <taxAmount>1300</taxAmount>
    <amountInclTax>11300</amountInclTax>
    <taxRate>0.13</taxRate>
  </invoice>
  <invoice>
    <invoiceCode>3300008888</invoiceCode>
    <invoiceNo>00002001</invoiceNo>
    <invoiceType>SPECIAL</invoiceType>
    <direction>INPUT</direction>
    <billingDate>2026-06-12</billingDate>
    <buyerName>测试一般纳税人有限公司</buyerName>
    <sellerName>供应商乙公司</sellerName>
    <buyerTaxNo>91330000GENERAL01</buyerTaxNo>
    <sellerTaxNo>91330000SELLER02</sellerTaxNo>
    <amountExclTax>5000</amountExclTax>
    <taxAmount>650</taxAmount>
    <amountInclTax>5650</amountInclTax>
    <taxRate>0.13</taxRate>
  </invoice>
</invoices>`;
    return Buffer.from(xml, 'utf8');
}
// HTTP 请求辅助
async function request(method, path, token, body, headers) {
    const hdrs = { ...(headers || {}) };
    let payload;
    if (body !== undefined) {
        payload = JSON.stringify(body);
        hdrs['Content-Type'] = 'application/json';
        hdrs['Content-Length'] = Buffer.byteLength(payload).toString();
    }
    if (token)
        hdrs['Authorization'] = `Bearer ${token}`;
    const opts = { method, path, host: '127.0.0.1', port: TEST_PORT, headers: hdrs };
    return new Promise((resolve, reject) => {
        const req = http_1.default.request(opts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                let data = null;
                const ct = res.headers['content-type'] || '';
                if (ct.includes('application/json') && buf.length) {
                    data = JSON.parse(buf.toString());
                }
                else if (ct.includes('sheet') || buf.length) {
                    data = buf; // 二进制（Excel）
                }
                resolve({ status: res.statusCode || 0, data });
            });
        });
        req.on('error', reject);
        if (payload)
            req.write(payload);
        req.end();
    });
}
// 断言辅助
function assert(cond, msg) {
    if (!cond) {
        throw new Error(`❌ 断言失败: ${msg}`);
    }
    console.log(`  ✅ ${msg}`);
}
async function main() {
    console.log('=== Task6 税务申报模块端到端测试开始 ===\n');
    // 0. 确保 admin 用户存在
    const adminHash = await bcryptjs_1.default.hash('admin123', 10);
    const admin = await prisma_1.default.user.upsert({
        where: { username: 'admin' },
        update: {},
        create: { username: 'admin', passwordHash: adminHash, role: 'ADMIN' },
    });
    // 创建/复用测试主体（一般纳税人），并初始化科目体系
    const taxNumber = 'TEST_TAX_RETURN_001';
    await prisma_1.default.taxReturn.deleteMany({ where: { subject: { taxNumber } } }).catch(() => undefined);
    let subject = await prisma_1.default.taxpayerSubject.findUnique({ where: { taxNumber } });
    if (!subject) {
        subject = await prisma_1.default.taxpayerSubject.create({
            data: {
                name: '税务申报测试主体',
                taxNumber,
                taxpayerType: 'GENERAL',
                taxRate: 0.13,
            },
        });
        await prisma_1.default.account.createMany({
            data: accounts_1.GENERAL_TAXPAYER_ACCOUNTS.map((a) => ({
                subjectId: subject.id,
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
    }
    else {
        console.log(`复用已有测试主体: id=${subject.id}, name=${subject.name}`);
    }
    const subjectId = subject.id;
    // 清理历史发票/凭证/工资，确保测试可重复
    await prisma_1.default.voucherEntry.deleteMany({ where: { voucher: { subjectId } } });
    await prisma_1.default.voucher.deleteMany({ where: { subjectId } });
    await prisma_1.default.invoice.deleteMany({ where: { subjectId } });
    await prisma_1.default.payrollRecord.deleteMany({ where: { subjectId } });
    await prisma_1.default.taxReturn.deleteMany({ where: { subjectId } });
    console.log('已清理历史发票/凭证/工资/申报数据');
    // 1. 导入发票（销项 10000+1300，进项 5000+650）
    const invResult = await (0, importService_1.importInvoices)(subjectId, buildInvoiceXml(), 'tax_test_invoices.xml', admin.id);
    console.log(`\n发票导入: 成功 ${invResult.successCount} 条`);
    assert(invResult.successCount === 2, '发票导入成功2条（销项+进项）');
    // 2. 录入凭证并过账
    // 获取科目 ID
    const findAcct = async (code) => {
        const a = await prisma_1.default.account.findFirst({ where: { subjectId, code } });
        if (!a)
            throw new Error(`科目 ${code} 不存在`);
        return a.id;
    };
    const acct = {
        ar: await findAcct('1122'), // 应收账款
        ap: await findAcct('2202'), // 应付账款
        inv: await findAcct('1405'), // 库存商品
        cash: await findAcct('1002'), // 银行存款
        revenue: await findAcct('6001'), // 主营业务收入
        cost: await findAcct('6401'), // 主营业务成本
        outputTax: await findAcct('22210101'), // 销项税额
        inputTax: await findAcct('22210102'), // 进项税额
        adminExp: await findAcct('6602'), // 管理费用
    };
    // 凭证1：销售 借应收 11300 / 贷收入 10000 / 贷销项 1300
    const v1 = await (0, voucherService_1.createVoucher)(subjectId, {
        voucherDate: '2026-06-10',
        summary: '6月销售商品',
        entries: [
            { accountId: acct.ar, debit: 11300, credit: 0 },
            { accountId: acct.revenue, debit: 0, credit: 10000 },
            { accountId: acct.outputTax, debit: 0, credit: 1300 },
        ],
    }, admin.id);
    await (0, voucherService_1.postVoucher)(v1.id, admin.id);
    // 凭证2：采购 借库存 5000 / 借进项 650 / 贷应付 5650
    const v2 = await (0, voucherService_1.createVoucher)(subjectId, {
        voucherDate: '2026-06-12',
        summary: '6月采购商品',
        entries: [
            { accountId: acct.inv, debit: 5000, credit: 0 },
            { accountId: acct.inputTax, debit: 650, credit: 0 },
            { accountId: acct.ap, debit: 0, credit: 5650 },
        ],
    }, admin.id);
    await (0, voucherService_1.postVoucher)(v2.id, admin.id);
    // 凭证3：结转成本 借主营业务成本 5000 / 贷库存商品 5000
    const v3 = await (0, voucherService_1.createVoucher)(subjectId, {
        voucherDate: '2026-06-15',
        summary: '结转销售成本',
        entries: [
            { accountId: acct.cost, debit: 5000, credit: 0 },
            { accountId: acct.inv, debit: 0, credit: 5000 },
        ],
    }, admin.id);
    await (0, voucherService_1.postVoucher)(v3.id, admin.id);
    // 凭证4：管理费用 借管理费用 1000 / 贷银行存款 1000
    const v4 = await (0, voucherService_1.createVoucher)(subjectId, {
        voucherDate: '2026-06-18',
        summary: '6月办公费',
        entries: [
            { accountId: acct.adminExp, debit: 1000, credit: 0 },
            { accountId: acct.cash, debit: 0, credit: 1000 },
        ],
    }, admin.id);
    await (0, voucherService_1.postVoucher)(v4.id, admin.id);
    console.log('已录入并过账4张凭证（销售/采购/成本/管理费用）');
    // 3. 启动测试服务器
    await new Promise((resolve) => {
        server = app_1.default.listen(TEST_PORT, () => resolve());
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
        // ===== 测试1：生成增值税申报 =====
        console.log('\n--- 测试1：生成增值税申报（一般纳税人，2026-06）---');
        const vatResp = await request('POST', '/api/tax-returns/generate', token, {
            subjectId,
            taxType: 'VAT',
            period: '2026-06',
        });
        assert(vatResp.status === 201, `增值税申报生成接口返回 201（实际 ${vatResp.status}）`);
        const vatReport = vatResp.data.reportData;
        const vatSummary = vatReport.summary;
        console.log(`  销项税额=${vatSummary.outputTax}, 进项税额=${vatSummary.inputTax}, 应纳税额=${vatSummary.taxAmount}, 期末留抵=${vatSummary.endingCredit}`);
        assert(vatSummary.outputTax === 1300, '销项税额 = 1300（凭证销项科目贷方）');
        assert(vatSummary.inputTax === 650, '进项税额 = 650（凭证进项科目借方）');
        // 应纳税额 = 销项 - 期初留抵(0) - 进项 = 1300 - 0 - 650 = 650
        assert(vatSummary.taxAmount === 650, '增值税应纳税额 = 销项1300 - 进项650 = 650');
        assert(vatResp.data.status === 'DRAFT', '生成后状态为 DRAFT');
        const vatId = vatResp.data.id;
        const vatMainForm = vatReport.mainForm;
        assert(vatMainForm['应纳税额'] === 650, '主表应纳税额 = 650');
        assert(vatMainForm['期末留抵税额'] === 0, '期末留抵 = 0（销项>进项）');
        // ===== 测试2：生成附加税申报（基于增值税额 650）=====
        console.log('\n--- 测试2：生成附加税申报（2026-06，基于增值税 650）---');
        const surResp = await request('POST', '/api/tax-returns/generate', token, {
            subjectId,
            taxType: 'SURTAX',
            period: '2026-06',
            urbanRate: 0.07,
        });
        assert(surResp.status === 201, `附加税申报生成接口返回 201（实际 ${surResp.status}）`);
        const surReport = surResp.data.reportData;
        console.log(`  计税依据(增值税)=${surReport.vatPayable}, 城建税=${surReport.items[0].amount}, 教育费附加=${surReport.items[1].amount}, 地方教育附加=${surReport.items[2].amount}, 合计=${surReport.total}`);
        assert(surReport.vatPayable === 650, '附加税计税依据 = 增值税额 650');
        assert(surReport.items[0].amount === 45.5, '城建税 = 650 × 7% = 45.5');
        assert(surReport.items[1].amount === 19.5, '教育费附加 = 650 × 3% = 19.5');
        assert(surReport.items[2].amount === 13, '地方教育附加 = 650 × 2% = 13');
        assert(surReport.total === 78, '附加税合计 = 45.5 + 19.5 + 13 = 78');
        // ===== 测试3：生成企业所得税（季度 2026-Q2）=====
        console.log('\n--- 测试3：生成企业所得税申报（季度 2026-Q2）---');
        const citResp = await request('POST', '/api/tax-returns/generate', token, {
            subjectId,
            taxType: 'CIT',
            period: '2026-Q2',
        });
        assert(citResp.status === 201, `企业所得税申报生成接口返回 201（实际 ${citResp.status}）`);
        const citReport = citResp.data.reportData;
        console.log(`  营业收入=${citReport.revenue}, 营业成本=${citReport.cost}, 期间费用=${citReport.expenses}, 利润=${citReport.profit}, 应纳所得税=${citReport.taxAmount}`);
        assert(citReport.revenue === 10000, '营业收入 = 10000');
        assert(citReport.cost === 5000, '营业成本 = 5000');
        assert(citReport.expenses === 1000, '期间费用 = 1000（管理费用）');
        assert(citReport.profit === 4000, '利润总额 = 10000 - 5000 - 1000 = 4000');
        // 小型微利：4000 ≤ 100万，税额 = 4000 × 25% × 20% = 200
        assert(citReport.taxAmount === 200, '企业所得税 = 4000 × 25% × 20% = 200（小型微利优惠）');
        // ===== 测试4：列表查询 =====
        console.log('\n--- 测试4：申报列表查询 ---');
        const listResp = await request('GET', `/api/tax-returns?subjectId=${subjectId}&pageSize=50`, token);
        assert(listResp.status === 200, '列表查询返回 200');
        assert(listResp.data.total === 3, `列表共3条申报记录（实际 ${listResp.data.total}）`);
        const vatListItem = listResp.data.items.find((i) => i.taxType === 'VAT' && i.period === '2026-06');
        assert(!!vatListItem, '列表包含增值税申报记录');
        assert(vatListItem.taxAmount === 650, '列表项应纳税额 = 650');
        // ===== 测试5：详情查询 =====
        console.log('\n--- 测试5：申报详情查询 ---');
        const detailResp = await request('GET', `/api/tax-returns/${vatId}`, token);
        assert(detailResp.status === 200, '详情查询返回 200');
        assert(detailResp.data.reportData.summary.taxAmount === 650, '详情 reportData 解析正确，应纳税额=650');
        assert(detailResp.data.taxAmount === 650, '详情 taxAmount 字段 = 650');
        // ===== 测试6：状态流转 DRAFT→PENDING→FILED→PAID =====
        console.log('\n--- 测试6：状态流转 DRAFT→PENDING→FILED→PAID ---');
        assert(detailResp.data.status === 'DRAFT', '初始状态为 DRAFT');
        // 非法流转：DRAFT → FILED（跳过 PENDING）应被拒绝
        const badResp = await request('PUT', `/api/tax-returns/${vatId}/status`, token, {
            status: 'FILED',
        });
        assert(badResp.status === 400, '非法流转 DRAFT→FILED 被拒绝（400）');
        // DRAFT → PENDING
        const r1 = await request('PUT', `/api/tax-returns/${vatId}/status`, token, { status: 'PENDING' });
        assert(r1.status === 200 && r1.data.status === 'PENDING', 'DRAFT → PENDING 成功');
        // PENDING → FILED（记录 filedAt/filedBy）
        const r2 = await request('PUT', `/api/tax-returns/${vatId}/status`, token, { status: 'FILED' });
        assert(r2.status === 200 && r2.data.status === 'FILED', 'PENDING → FILED 成功');
        assert(!!r2.data.filedAt, 'FILED 已记录 filedAt');
        assert(r2.data.filedBy === admin.id, 'FILED 已记录 filedBy');
        // FILED → PAID（记录 paidAt/paidBy + paymentVoucher）
        const r3 = await request('PUT', `/api/tax-returns/${vatId}/status`, token, {
            status: 'PAID',
            paymentVoucher: 'PAY-2026-0001',
        });
        assert(r3.status === 200 && r3.data.status === 'PAID', 'FILED → PAID 成功');
        assert(!!r3.data.paidAt, 'PAID 已记录 paidAt');
        assert(r3.data.paidBy === admin.id, 'PAID 已记录 paidBy');
        assert(r3.data.paymentVoucher === 'PAY-2026-0001', 'PAID 已记录缴款凭证号');
        // 终态 PAID → 无下一状态，再变更应被拒绝
        const r4 = await request('PUT', `/api/tax-returns/${vatId}/status`, token, { status: 'DRAFT' });
        assert(r4.status === 400, 'PAID 终态再变更被拒绝（400）');
        // ===== 测试7：导出 Excel =====
        console.log('\n--- 测试7：导出申报表 Excel ---');
        const expResp = await request('GET', `/api/tax-returns/${vatId}/export`, token);
        assert(expResp.status === 200, '导出接口返回 200');
        const ct = expResp.data;
        assert(Buffer.isBuffer(ct) && ct.length > 0, '导出返回非空二进制 Excel 内容');
        // ===== 测试8：vat-payable 预览接口 =====
        console.log('\n--- 测试8：应纳增值税额预览接口 ---');
        const vpResp = await request('GET', `/api/tax-returns/vat-payable?subjectId=${subjectId}&period=2026-06`, token);
        assert(vpResp.status === 200, 'vat-payable 接口返回 200');
        assert(vpResp.data.vatPayable === 650, '预览应纳增值税额 = 650');
        console.log('\n=== Task6 税务申报模块端到端测试全部通过 ✅ ===');
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
main()
    .catch((err) => {
    console.error('\n❌ 测试失败:', err.message);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma_1.default.$disconnect();
});
