"use strict";
// 智能记账服务（新手友好）
// 扫描已导入的发票/银行流水/工资记录，自动生成记账凭证（草稿），标记源数据 booked=true
//
// 业务识别规则：
//   销项发票(OUTPUT)：借1122应收账款(价税合计) 贷6001主营业务收入(不含税) 贷22210101销项税额(一般)/222101应交增值税(小规模)
//   进项发票(INPUT)：借1405库存商品(不含税)+22210102进项税额(一般) 贷2202应付账款(价税合计)；小规模借1405(价税合计) 贷2202(价税合计)
//   银行收款(IN)：借1002银行存款 贷1122应收账款；无法匹配→unidentified
//   银行付款(OUT)：借2202应付账款(或6602管理费用) 贷1002银行存款；无法匹配→unidentified
//   工资表(按period汇总)：计提 借6602管理费用 贷2211应付职工薪酬；发放 借2211 贷1002(实发)+贷222104个人所得税
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewBookings = previewBookings;
exports.generateBookings = generateBookings;
exports.getPendingReview = getPendingReview;
exports.batchPost = batchPost;
exports.getUnidentified = getUnidentified;
exports.assignManualEntry = assignManualEntry;
const prisma_1 = __importDefault(require("../utils/prisma"));
const voucherService_1 = require("./voucherService");
// ============ 辅助 ============
// 按主体+编码查找科目
async function findAccount(subjectId, code) {
    return prisma_1.default.account.findFirst({ where: { subjectId, code } });
}
// 判断是否一般纳税人
async function isGeneralTaxpayer(subjectId) {
    const subject = await prisma_1.default.taxpayerSubject.findUnique({ where: { id: subjectId } });
    return subject?.taxpayerType === 'GENERAL';
}
// 费用关键字（用于银行付款方向识别为管理费用）
const EXPENSE_KEYWORDS = ['费用', '办公', '差旅', '水电', '物业', '租赁', '加油', '餐', '交通', '通讯'];
// ============ 预览：previewBookings ============
// 扫描 booked=false 的发票/流水/工资，生成预览凭证（不落库）
async function previewBookings(subjectId, dataType) {
    const general = await isGeneralTaxpayer(subjectId);
    const bookings = [];
    const unidentified = [];
    // 预加载常用科目
    const accountCache = new Map();
    async function getAccount(code) {
        if (!accountCache.has(code)) {
            const acc = await findAccount(subjectId, code);
            if (acc)
                accountCache.set(code, { id: acc.id, code: acc.code, name: acc.name });
        }
        return accountCache.get(code);
    }
    // ===== 发票 =====
    if (!dataType || dataType === 'INVOICE') {
        const invoices = await prisma_1.default.invoice.findMany({
            where: { subjectId, booked: false, status: 'NORMAL' },
            orderBy: { billingDate: 'asc' },
        });
        for (const inv of invoices) {
            const amountExcl = Number(inv.amountExclTax.toString());
            const taxAmount = Number(inv.taxAmount.toString());
            const amountIncl = Number(inv.amountInclTax.toString());
            const dateStr = inv.billingDate.toISOString().slice(0, 10);
            if (inv.direction === 'OUTPUT') {
                // 销项发票
                const ar = await getAccount('1122'); // 应收账款
                const rev = await getAccount('6001'); // 主营业务收入
                const taxAcc = general ? await getAccount('22210101') : await getAccount('222101');
                if (!ar || !rev || !taxAcc)
                    continue; // 科目缺失跳过
                bookings.push({
                    sourceType: 'INVOICE',
                    sourceId: inv.id,
                    sourceDesc: `销项发票 ${inv.invoiceCode}-${inv.invoiceNo} ${inv.buyerName ?? ''} 价税合计${amountIncl.toFixed(2)}`,
                    voucherDate: dateStr,
                    voucherSummary: `销售-${inv.buyerName ?? ''}`,
                    identifiable: true,
                    entries: [
                        { accountCode: ar.code, accountName: ar.name, debit: amountIncl, credit: 0, summary: `应收-${inv.buyerName ?? ''}` },
                        { accountCode: rev.code, accountName: rev.name, debit: 0, credit: amountExcl, summary: '主营业务收入' },
                        { accountCode: taxAcc.code, accountName: taxAcc.name, debit: 0, credit: taxAmount, summary: '销项税额' },
                    ],
                });
            }
            else {
                // 进项发票
                const inventory = await getAccount('1405'); // 库存商品
                const ap = await getAccount('2202'); // 应付账款
                if (!inventory || !ap)
                    continue;
                if (general) {
                    const inputTax = await getAccount('22210102'); // 进项税额
                    if (!inputTax)
                        continue;
                    bookings.push({
                        sourceType: 'INVOICE',
                        sourceId: inv.id,
                        sourceDesc: `进项发票 ${inv.invoiceCode}-${inv.invoiceNo} ${inv.sellerName ?? ''} 价税合计${amountIncl.toFixed(2)}`,
                        voucherDate: dateStr,
                        voucherSummary: `采购-${inv.sellerName ?? ''}`,
                        identifiable: true,
                        entries: [
                            { accountCode: inventory.code, accountName: inventory.name, debit: amountExcl, credit: 0, summary: `采购-${inv.sellerName ?? ''}` },
                            { accountCode: inputTax.code, accountName: inputTax.name, debit: taxAmount, credit: 0, summary: '进项税额' },
                            { accountCode: ap.code, accountName: ap.name, debit: 0, credit: amountIncl, summary: `应付-${inv.sellerName ?? ''}` },
                        ],
                    });
                }
                else {
                    // 小规模：进项税额计入库存商品
                    bookings.push({
                        sourceType: 'INVOICE',
                        sourceId: inv.id,
                        sourceDesc: `进项发票 ${inv.invoiceCode}-${inv.invoiceNo} ${inv.sellerName ?? ''} 价税合计${amountIncl.toFixed(2)}`,
                        voucherDate: dateStr,
                        voucherSummary: `采购-${inv.sellerName ?? ''}`,
                        identifiable: true,
                        entries: [
                            { accountCode: inventory.code, accountName: inventory.name, debit: amountIncl, credit: 0, summary: `采购-${inv.sellerName ?? ''}` },
                            { accountCode: ap.code, accountName: ap.name, debit: 0, credit: amountIncl, summary: `应付-${inv.sellerName ?? ''}` },
                        ],
                    });
                }
            }
        }
    }
    // ===== 银行流水 =====
    if (!dataType || dataType === 'BANK') {
        const txns = await prisma_1.default.bankTransaction.findMany({
            where: { subjectId, booked: false },
            orderBy: { transDate: 'asc' },
        });
        // 预加载购销方名称用于匹配
        const outputBuyers = await prisma_1.default.invoice.findMany({
            where: { subjectId, direction: 'OUTPUT' },
            select: { buyerName: true },
            distinct: ['buyerName'],
        });
        const inputSellers = await prisma_1.default.invoice.findMany({
            where: { subjectId, direction: 'INPUT' },
            select: { sellerName: true },
            distinct: ['sellerName'],
        });
        const buyerSet = new Set(outputBuyers.map((i) => i.buyerName).filter(Boolean));
        const sellerSet = new Set(inputSellers.map((i) => i.sellerName).filter(Boolean));
        const bank = await getAccount('1002'); // 银行存款
        const ar = await getAccount('1122'); // 应收账款
        const ap = await getAccount('2202'); // 应付账款
        const expense = await getAccount('6602'); // 管理费用
        for (const txn of txns) {
            const amount = Number(txn.amount.toString());
            const dateStr = txn.transDate.toISOString().slice(0, 10);
            const counterparty = (txn.counterparty ?? '').trim();
            const summaryText = (txn.summary ?? '').trim();
            if (txn.direction === 'IN') {
                // 收款：匹配购方（销项发票的买方）
                if (counterparty && buyerSet.has(counterparty) && bank && ar) {
                    bookings.push({
                        sourceType: 'BANK',
                        sourceId: txn.id,
                        sourceDesc: `银行收款 ${counterparty} ${amount.toFixed(2)}`,
                        voucherDate: dateStr,
                        voucherSummary: `收款-${counterparty}`,
                        identifiable: true,
                        entries: [
                            { accountCode: bank.code, accountName: bank.name, debit: amount, credit: 0, summary: `收款-${counterparty}` },
                            { accountCode: ar.code, accountName: ar.name, debit: 0, credit: amount, summary: `收应收-${counterparty}` },
                        ],
                    });
                }
                else {
                    unidentified.push({
                        id: txn.id,
                        transDate: dateStr,
                        amount,
                        direction: txn.direction,
                        counterparty: txn.counterparty,
                        summary: txn.summary,
                    });
                }
            }
            else {
                // 付款：匹配销方（进项发票的卖方）→应付账款；否则按费用关键字→管理费用
                if (counterparty && sellerSet.has(counterparty) && bank && ap) {
                    bookings.push({
                        sourceType: 'BANK',
                        sourceId: txn.id,
                        sourceDesc: `银行付款 ${counterparty} ${amount.toFixed(2)}`,
                        voucherDate: dateStr,
                        voucherSummary: `付款-${counterparty}`,
                        identifiable: true,
                        entries: [
                            { accountCode: ap.code, accountName: ap.name, debit: amount, credit: 0, summary: `付应付-${counterparty}` },
                            { accountCode: bank.code, accountName: bank.name, debit: 0, credit: amount, summary: `付款-${counterparty}` },
                        ],
                    });
                }
                else if (bank && expense && EXPENSE_KEYWORDS.some((k) => summaryText.includes(k) || counterparty.includes(k))) {
                    bookings.push({
                        sourceType: 'BANK',
                        sourceId: txn.id,
                        sourceDesc: `银行付款 ${counterparty} ${amount.toFixed(2)}（费用）`,
                        voucherDate: dateStr,
                        voucherSummary: `费用-${counterparty || summaryText}`,
                        identifiable: true,
                        entries: [
                            { accountCode: expense.code, accountName: expense.name, debit: amount, credit: 0, summary: `费用-${counterparty || summaryText}` },
                            { accountCode: bank.code, accountName: bank.name, debit: 0, credit: amount, summary: `付款-${counterparty}` },
                        ],
                    });
                }
                else {
                    unidentified.push({
                        id: txn.id,
                        transDate: dateStr,
                        amount,
                        direction: txn.direction,
                        counterparty: txn.counterparty,
                        summary: txn.summary,
                    });
                }
            }
        }
    }
    // ===== 工资记录（按 period 汇总）=====
    if (!dataType || dataType === 'PAYROLL') {
        const records = await prisma_1.default.payrollRecord.findMany({
            where: { subjectId, booked: false },
            orderBy: { period: 'asc' },
        });
        // 按 period 分组
        const periodMap = new Map();
        for (const r of records) {
            const cur = periodMap.get(r.period) ?? { gross: 0, tax: 0, net: 0, count: 0 };
            cur.gross += Number(r.grossSalary.toString());
            cur.tax += Number(r.taxWithheld.toString());
            cur.net += Number(r.netSalary.toString());
            cur.count++;
            periodMap.set(r.period, cur);
        }
        const expense = await getAccount('6602'); // 管理费用
        const payable = await getAccount('2211'); // 应付职工薪酬
        const bank = await getAccount('1002'); // 银行存款
        const iit = await getAccount('222104'); // 个人所得税
        for (const [period, agg] of periodMap.entries()) {
            // 期末日期
            const [y, m] = period.split('-').map(Number);
            const periodEnd = new Date(y, m, 0).toISOString().slice(0, 10);
            // 计提凭证：借6602管理费用 贷2211应付职工薪酬
            if (expense && payable) {
                bookings.push({
                    sourceType: 'PAYROLL',
                    sourceId: -1,
                    sourceDesc: `${period} 工资计提 共${agg.count}人 应发${agg.gross.toFixed(2)}`,
                    voucherDate: periodEnd,
                    voucherSummary: `${period}工资计提`,
                    identifiable: true,
                    entries: [
                        { accountCode: expense.code, accountName: expense.name, debit: agg.gross, credit: 0, summary: `${period}工资` },
                        { accountCode: payable.code, accountName: payable.name, debit: 0, credit: agg.gross, summary: `${period}应付工资` },
                    ],
                });
            }
            // 发放凭证：借2211应付职工薪酬 贷1002银行存款(实发)+贷222104个人所得税(代扣)
            if (payable && bank) {
                const entries = [
                    { accountCode: payable.code, accountName: payable.name, debit: agg.gross, credit: 0, summary: `${period}发放工资` },
                    { accountCode: bank.code, accountName: bank.name, debit: 0, credit: agg.net, summary: `${period}实发工资` },
                ];
                if (agg.tax > 0 && iit) {
                    entries.push({ accountCode: iit.code, accountName: iit.name, debit: 0, credit: agg.tax, summary: `${period}代扣个税` });
                }
                bookings.push({
                    sourceType: 'PAYROLL',
                    sourceId: -2,
                    sourceDesc: `${period} 工资发放 共${agg.count}人 实发${agg.net.toFixed(2)}`,
                    voucherDate: periodEnd,
                    voucherSummary: `${period}工资发放`,
                    identifiable: true,
                    entries,
                });
            }
        }
    }
    return { bookings, unidentified };
}
// ============ 生成记账：generateBookings ============
// 生成 DRAFT 凭证，标记源数据 booked=true + voucherId
async function generateBookings(subjectId, userId, dataType) {
    const { bookings } = await previewBookings(subjectId, dataType);
    const general = await isGeneralTaxpayer(subjectId);
    // 科目缓存（含 id）
    const accountCache = new Map();
    async function getAccountId(code) {
        if (!accountCache.has(code)) {
            const acc = await findAccount(subjectId, code);
            accountCache.set(code, acc?.id ?? -1);
        }
        const v = accountCache.get(code);
        return v && v > 0 ? v : null;
    }
    const createdVouchers = [];
    // 按来源分组：发票/银行按单条生成；工资按 period 汇总（计提+发放两条）
    // 预览结果中 PAYROLL 的 sourceId 为 -1(计提)/-2(发放)，需特殊处理
    // 为简化：直接按预览的 entries 创建凭证，然后回写源数据
    // 按 sourceType 分组处理，便于回写 booked
    const invoiceBookings = bookings.filter((b) => b.sourceType === 'INVOICE');
    const bankBookings = bookings.filter((b) => b.sourceType === 'BANK' && b.identifiable);
    const payrollBookings = bookings.filter((b) => b.sourceType === 'PAYROLL');
    // 发票凭证
    for (const bk of invoiceBookings) {
        const entries = [];
        for (const e of bk.entries) {
            const accId = await getAccountId(e.accountCode);
            if (!accId)
                continue;
            entries.push({ accountId: accId, summary: e.summary, debit: e.debit, credit: e.credit });
        }
        if (entries.length === 0)
            continue;
        try {
            const voucher = await (0, voucherService_1.createVoucher)(subjectId, {
                voucherDate: bk.voucherDate,
                summary: bk.voucherSummary,
                entries,
            }, userId);
            // 回写发票 booked
            await prisma_1.default.invoice.update({
                where: { id: bk.sourceId },
                data: { booked: true, voucherId: voucher.id },
            });
            createdVouchers.push(voucher);
        }
        catch (err) {
            // 单条失败不影响其他
            console.error(`[智能记账] 发票 ${bk.sourceId} 生成凭证失败:`, err);
        }
    }
    // 银行流水凭证
    for (const bk of bankBookings) {
        const entries = [];
        for (const e of bk.entries) {
            const accId = await getAccountId(e.accountCode);
            if (!accId)
                continue;
            entries.push({ accountId: accId, summary: e.summary, debit: e.debit, credit: e.credit });
        }
        if (entries.length === 0)
            continue;
        try {
            const voucher = await (0, voucherService_1.createVoucher)(subjectId, {
                voucherDate: bk.voucherDate,
                summary: bk.voucherSummary,
                entries,
            }, userId);
            await prisma_1.default.bankTransaction.update({
                where: { id: bk.sourceId },
                data: { booked: true, voucherId: voucher.id },
            });
            createdVouchers.push(voucher);
        }
        catch (err) {
            console.error(`[智能记账] 银行流水 ${bk.sourceId} 生成凭证失败:`, err);
        }
    }
    // 工资凭证（按 period 汇总，计提+发放）
    // 预览中已按 period 聚合，直接创建凭证，然后回写该 period 所有记录 booked
    for (const bk of payrollBookings) {
        const entries = [];
        for (const e of bk.entries) {
            const accId = await getAccountId(e.accountCode);
            if (!accId)
                continue;
            entries.push({ accountId: accId, summary: e.summary, debit: e.debit, credit: e.credit });
        }
        if (entries.length === 0)
            continue;
        // 从 voucherSummary 提取 period（格式 "YYYY-MM工资计提"/"YYYY-MM工资发放"）
        const periodMatch = bk.voucherSummary.match(/^(\d{4}-\d{2})/);
        const period = periodMatch ? periodMatch[1] : null;
        try {
            const voucher = await (0, voucherService_1.createVoucher)(subjectId, {
                voucherDate: bk.voucherDate,
                summary: bk.voucherSummary,
                entries,
            }, userId);
            // 回写该 period 所有未记账的工资记录
            if (period) {
                await prisma_1.default.payrollRecord.updateMany({
                    where: { subjectId, period, booked: false },
                    data: { booked: true, voucherId: voucher.id },
                });
            }
            createdVouchers.push(voucher);
        }
        catch (err) {
            console.error(`[智能记账] 工资 ${bk.voucherSummary} 生成凭证失败:`, err);
        }
    }
    void general; // 一般纳税人判断已在 previewBookings 内使用
    return { generated: createdVouchers.length, vouchers: createdVouchers };
}
// ============ 待审核：getPendingReview ============
// 返回已生成未过账的凭证（DRAFT 状态，由智能记账生成）
async function getPendingReview(subjectId) {
    const vouchers = await prisma_1.default.voucher.findMany({
        where: { subjectId, status: 'DRAFT' },
        orderBy: { voucherDate: 'desc' },
        include: {
            entries: { include: { account: { select: { code: true, name: true } } } },
        },
    });
    return vouchers.map(voucherService_1.serializeVoucher);
}
// ============ 批量过账：batchPost ============
// 批量过账草稿凭证
async function batchPost(voucherIds, userId) {
    const results = [];
    for (const id of voucherIds) {
        try {
            await (0, voucherService_1.postVoucher)(id, userId);
            results.push({ id, success: true });
        }
        catch (err) {
            results.push({ id, success: false, error: err instanceof Error ? err.message : '过账失败' });
        }
    }
    const successCount = results.filter((r) => r.success).length;
    return { successCount, failCount: results.length - successCount, results };
}
// ============ 无法识别流水：getUnidentified ============
// 返回无法识别的银行流水（booked=false 且未能自动匹配）
async function getUnidentified(subjectId) {
    const { unidentified } = await previewBookings(subjectId, 'BANK');
    return unidentified;
}
// ============ 人工指定科目：assignManualEntry ============
// 人工指定科目生成凭证（针对无法识别的银行流水）
async function assignManualEntry(subjectId, bankTransactionId, accountId, userId) {
    const txn = await prisma_1.default.bankTransaction.findUnique({ where: { id: bankTransactionId } });
    if (!txn || txn.subjectId !== subjectId) {
        throw new Error('银行流水不存在');
    }
    if (txn.booked) {
        throw new Error('该流水已生成凭证');
    }
    // 校验科目属于该主体且为末级
    const account = await prisma_1.default.account.findFirst({ where: { id: accountId, subjectId } });
    if (!account) {
        throw new Error('科目不存在');
    }
    if (!account.isLeaf) {
        throw new Error('科目不是末级，不能直接记账');
    }
    // 银行存款科目
    const bankAccount = await findAccount(subjectId, '1002');
    if (!bankAccount) {
        throw new Error('未找到银行存款科目(1002)');
    }
    const amount = Number(txn.amount.toString());
    const dateStr = txn.transDate.toISOString().slice(0, 10);
    const counterparty = (txn.counterparty ?? '').trim();
    // 借/贷方分配：流水为收入(IN)→借银行贷指定科目；支出(OUT)→借指定科目贷银行
    let entries;
    if (txn.direction === 'IN') {
        entries = [
            { accountId: bankAccount.id, summary: `收款-${counterparty}`, debit: amount, credit: 0 },
            { accountId, summary: `收款-${counterparty}`, debit: 0, credit: amount },
        ];
    }
    else {
        entries = [
            { accountId, summary: `付款-${counterparty}`, debit: amount, credit: 0 },
            { accountId: bankAccount.id, summary: `付款-${counterparty}`, debit: 0, credit: amount },
        ];
    }
    const voucher = await (0, voucherService_1.createVoucher)(subjectId, {
        voucherDate: dateStr,
        summary: `${txn.direction === 'IN' ? '收款' : '付款'}-${counterparty}`,
        entries,
    }, userId);
    // 回写流水 booked
    await prisma_1.default.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { booked: true, voucherId: voucher.id },
    });
    return voucher;
}
