"use strict";
// 凭证记账服务层（Task3）
// 核心业务逻辑：创建/过账/作废/红冲/期末结转/科目余额计算
//
// 余额计算说明：不单独存余额表，实时从 VoucherEntry 聚合。
// 已过账凭证包含两类状态：POSTED（正常过账）与 RED_VOID（红冲凭证，已自动过账）。
// 红冲凭证虽状态为 RED_VOID，但已"自动过账"（postedBy/postedAt 已设置），
// 因此同样计入余额聚合，从而对原凭证达到冲销效果。
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeVoucher = serializeVoucher;
exports.createVoucher = createVoucher;
exports.updateVoucher = updateVoucher;
exports.deleteVoucher = deleteVoucher;
exports.postVoucher = postVoucher;
exports.voidVoucher = voidVoucher;
exports.redOffsetVoucher = redOffsetVoucher;
exports.periodClose = periodClose;
exports.getAccountBalance = getAccountBalance;
exports.getSubjectBalances = getSubjectBalances;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../utils/prisma"));
const riskScanService_1 = require("./riskScanService");
// ============ 状态常量 ============
const STATUS_DRAFT = 'DRAFT'; // 草稿
const STATUS_POSTED = 'POSTED'; // 已过账
const STATUS_VOID = 'VOID'; // 已作废
const STATUS_RED_VOID = 'RED_VOID'; // 红冲
// 计入余额的凭证状态：POSTED 与 RED_VOID（红冲已自动过账）
const POSTED_STATUSES = [STATUS_POSTED, STATUS_RED_VOID];
// 损益类科目类别
const PNL_CATEGORIES = ['INCOME', 'EXPENSE'];
// 本年利润科目编码
const PROFIT_ACCOUNT_CODE = '4103';
// ============ 内部辅助 ============
// 左补零到两位（月份/日期）
function pad2(n) {
    return String(n).padStart(2, '0');
}
// 生成凭证字号：按主体+年月顺序，如 "记-2026-07-001"
// prefix 默认 "记"，红冲用 "红"，期末结转用 "结"
async function generateVoucherNo(subjectId, voucherDate, prefix = '记') {
    const date = new Date(voucherDate);
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const prefixStr = `${prefix}-${year}-${month}-`;
    // 查询当月该前缀下已有最大序号
    const existing = await prisma_1.default.voucher.findMany({
        where: { subjectId, voucherNo: { startsWith: prefixStr } },
        select: { voucherNo: true },
    });
    let maxSeq = 0;
    for (const v of existing) {
        const seqStr = v.voucherNo.slice(prefixStr.length);
        const seq = parseInt(seqStr, 10);
        if (!Number.isNaN(seq) && seq > maxSeq)
            maxSeq = seq;
    }
    return `${prefixStr}${String(maxSeq + 1).padStart(3, '0')}`;
}
// 聚合某科目已过账凭证的借/贷方发生额
// dateFilter 为可选的 voucherDate 过滤条件
async function aggregatePosted(subjectId, accountId, dateFilter) {
    const result = await prisma_1.default.voucherEntry.aggregate({
        _sum: { debit: true, credit: true },
        where: {
            accountId,
            voucher: {
                subjectId,
                status: { in: POSTED_STATUSES },
                ...(dateFilter ? { voucherDate: dateFilter } : {}),
            },
        },
    });
    return {
        debit: result._sum.debit ?? new client_1.Prisma.Decimal(0),
        credit: result._sum.credit ?? new client_1.Prisma.Decimal(0),
    };
}
// ============ 序列化 ============
// 将凭证（含分录）序列化为 JSON 友好结构，Decimal 转为 number
// account 字段允许部分字段缺失（列表查询仅取 code/name，详情取全字段）
function serializeVoucher(voucher) {
    return {
        id: voucher.id,
        subjectId: voucher.subjectId,
        voucherNo: voucher.voucherNo,
        voucherDate: voucher.voucherDate,
        summary: voucher.summary,
        attachments: voucher.attachments,
        status: voucher.status,
        createdBy: voucher.createdBy,
        postedBy: voucher.postedBy,
        postedAt: voucher.postedAt,
        redOffsetVoucherId: voucher.redOffsetVoucherId,
        createdAt: voucher.createdAt,
        updatedAt: voucher.updatedAt,
        entries: (voucher.entries ?? []).map((e) => ({
            id: e.id,
            voucherId: e.voucherId,
            accountId: e.accountId,
            summary: e.summary,
            debit: Number(e.debit.toString()),
            credit: Number(e.credit.toString()),
            account: e.account
                ? {
                    id: e.account.id,
                    code: e.account.code,
                    name: e.account.name,
                    category: e.account.category,
                    direction: e.account.direction,
                    balanceDirection: e.account.balanceDirection,
                }
                : undefined,
        })),
    };
}
// ============ 业务方法 ============
// 创建草稿凭证
// 校验：借贷必须平衡（sum(debit)==sum(credit) 且 >0）；所有 accountId 属于该 subject 且为末级
async function createVoucher(subjectId, data, userId) {
    // 校验主体存在
    const subject = await prisma_1.default.taxpayerSubject.findUnique({ where: { id: subjectId } });
    if (!subject) {
        throw new Error('纳税人主体不存在');
    }
    // 校验分录非空
    if (!data.entries || data.entries.length === 0) {
        throw new Error('凭证分录不能为空');
    }
    // 计算借贷合计
    let sumDebit = new client_1.Prisma.Decimal(0);
    let sumCredit = new client_1.Prisma.Decimal(0);
    for (const e of data.entries) {
        sumDebit = sumDebit.add(new client_1.Prisma.Decimal(e.debit || 0));
        sumCredit = sumCredit.add(new client_1.Prisma.Decimal(e.credit || 0));
    }
    // 借贷必须平衡且 > 0
    if (!sumDebit.equals(sumCredit) || sumDebit.lte(0)) {
        throw new Error('借贷必须平衡');
    }
    // 校验所有 accountId 属于该 subject 且为末级科目
    const accountIds = [...new Set(data.entries.map((e) => e.accountId))];
    const accounts = await prisma_1.default.account.findMany({
        where: { id: { in: accountIds }, subjectId },
    });
    if (accounts.length !== accountIds.length) {
        throw new Error('部分科目不属于该纳税人主体');
    }
    for (const acc of accounts) {
        if (!acc.isLeaf) {
            throw new Error(`科目 ${acc.code} ${acc.name} 不是末级科目，不能直接记账`);
        }
    }
    // 生成凭证字号
    const voucherNo = await generateVoucherNo(subjectId, data.voucherDate);
    // 创建凭证 + 分录
    const voucher = await prisma_1.default.voucher.create({
        data: {
            subjectId,
            voucherNo,
            voucherDate: new Date(data.voucherDate),
            summary: data.summary ?? null,
            attachments: data.attachments ?? 0,
            status: STATUS_DRAFT,
            createdBy: userId,
            entries: {
                create: data.entries.map((e) => ({
                    accountId: e.accountId,
                    summary: e.summary ?? null,
                    debit: new client_1.Prisma.Decimal(e.debit || 0),
                    credit: new client_1.Prisma.Decimal(e.credit || 0),
                })),
            },
        },
        include: { entries: true },
    });
    return serializeVoucher(voucher);
}
// 修改草稿凭证（仅 DRAFT 可改）
async function updateVoucher(voucherId, data, userId) {
    const voucher = await prisma_1.default.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) {
        throw new Error('凭证不存在');
    }
    if (voucher.status !== STATUS_DRAFT) {
        throw new Error('已过账凭证不可直接修改，需红冲后再录新凭证');
    }
    // 校验分录非空
    if (!data.entries || data.entries.length === 0) {
        throw new Error('凭证分录不能为空');
    }
    // 计算借贷合计
    let sumDebit = new client_1.Prisma.Decimal(0);
    let sumCredit = new client_1.Prisma.Decimal(0);
    for (const e of data.entries) {
        sumDebit = sumDebit.add(new client_1.Prisma.Decimal(e.debit || 0));
        sumCredit = sumCredit.add(new client_1.Prisma.Decimal(e.credit || 0));
    }
    if (!sumDebit.equals(sumCredit) || sumDebit.lte(0)) {
        throw new Error('借贷必须平衡');
    }
    // 校验科目归属与末级
    const accountIds = [...new Set(data.entries.map((e) => e.accountId))];
    const accounts = await prisma_1.default.account.findMany({
        where: { id: { in: accountIds }, subjectId: voucher.subjectId },
    });
    if (accounts.length !== accountIds.length) {
        throw new Error('部分科目不属于该纳税人主体');
    }
    for (const acc of accounts) {
        if (!acc.isLeaf) {
            throw new Error(`科目 ${acc.code} ${acc.name} 不是末级科目，不能直接记账`);
        }
    }
    // 事务：先删旧分录，再更新凭证头与分录
    const updated = await prisma_1.default.$transaction(async (tx) => {
        await tx.voucherEntry.deleteMany({ where: { voucherId } });
        return tx.voucher.update({
            where: { id: voucherId },
            data: {
                voucherDate: new Date(data.voucherDate),
                summary: data.summary ?? null,
                attachments: data.attachments ?? 0,
                // 记录最近修改人（复用 createdBy 不合适，此处不更新 createdBy）
                entries: {
                    create: data.entries.map((e) => ({
                        accountId: e.accountId,
                        summary: e.summary ?? null,
                        debit: new client_1.Prisma.Decimal(e.debit || 0),
                        credit: new client_1.Prisma.Decimal(e.credit || 0),
                    })),
                },
            },
            include: { entries: true },
        });
    });
    // userId 暂未单独记录修改人，保留参数以备扩展
    void userId;
    return serializeVoucher(updated);
}
// 删除凭证（仅 DRAFT 可删）
async function deleteVoucher(voucherId) {
    const voucher = await prisma_1.default.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) {
        throw new Error('凭证不存在');
    }
    if (voucher.status !== STATUS_DRAFT) {
        throw new Error('仅草稿凭证可删除');
    }
    await prisma_1.default.voucher.delete({ where: { id: voucherId } });
}
// 过账凭证：DRAFT → POSTED，记录 postedBy/postedAt
// 余额由实时聚合计算，过账仅变更状态
async function postVoucher(voucherId, userId) {
    const voucher = await prisma_1.default.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) {
        throw new Error('凭证不存在');
    }
    if (voucher.status !== STATUS_DRAFT) {
        throw new Error('仅草稿凭证可过账，当前状态不可过账');
    }
    const updated = await prisma_1.default.voucher.update({
        where: { id: voucherId },
        data: {
            status: STATUS_POSTED,
            postedBy: userId,
            postedAt: new Date(),
        },
        include: { entries: true },
    });
    // 凭证过账后异步触发风险扫描（不阻塞过账响应，满足 5 秒内扫描要求）
    (0, riskScanService_1.onVoucherPosted)(updated.subjectId);
    return serializeVoucher(updated);
}
// 作废凭证：仅 DRAFT 可作废（直接置 VOID）
// 已过账凭证不能直接作废，需走红冲
async function voidVoucher(voucherId, _userId) {
    const voucher = await prisma_1.default.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) {
        throw new Error('凭证不存在');
    }
    if (voucher.status === STATUS_VOID) {
        throw new Error('凭证已作废');
    }
    if (voucher.status !== STATUS_DRAFT) {
        throw new Error('已过账凭证不能直接作废，需走红冲');
    }
    const updated = await prisma_1.default.voucher.update({
        where: { id: voucherId },
        data: { status: STATUS_VOID },
        include: { entries: true },
    });
    return serializeVoucher(updated);
}
// 红冲凭证：对已过账凭证生成红冲凭证（金额取反，status=RED_VOID，自动过账）
// redOffsetVoucherId 指向原凭证，达到冲销效果
async function redOffsetVoucher(voucherId, userId, reason) {
    const original = await prisma_1.default.voucher.findUnique({
        where: { id: voucherId },
        include: { entries: true },
    });
    if (!original) {
        throw new Error('凭证不存在');
    }
    if (original.status !== STATUS_POSTED) {
        throw new Error('仅已过账凭证可红冲');
    }
    // 生成红冲凭证字号（"红" 前缀）
    const redVoucherNo = await generateVoucherNo(original.subjectId, original.voucherDate, '红');
    const redVoucher = await prisma_1.default.voucher.create({
        data: {
            subjectId: original.subjectId,
            voucherNo: redVoucherNo,
            voucherDate: original.voucherDate,
            summary: reason ? `红冲凭证：${reason}` : '红冲凭证',
            attachments: 0,
            status: STATUS_RED_VOID,
            createdBy: userId,
            // 自动过账
            postedBy: userId,
            postedAt: new Date(),
            redOffsetVoucherId: original.id,
            entries: {
                create: original.entries.map((e) => ({
                    accountId: e.accountId,
                    summary: e.summary,
                    // 金额取反：原借方变贷方，原贷方变借方
                    debit: e.credit,
                    credit: e.debit,
                })),
            },
        },
        include: { entries: true },
    });
    return serializeVoucher(redVoucher);
}
// 期末损益结转：将该月所有损益类（INCOME/EXPENSE）科目余额结转至"本年利润"(4103)
// 收入类科目借方结转（借:收入 贷:本年利润），支出类科目贷方结转（借:本年利润 贷:支出）
// 结转后损益类科目余额应为0；已结转过则提示不可重复
async function periodClose(subjectId, year, month, userId) {
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    // new Date(year, month, 0) 得到该月最后一天
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    // 检查是否已结转：按 "结-YYYY-MM-" 前缀的凭证字号判断
    const closePrefix = `结-${year}-${pad2(month)}-`;
    const existing = await prisma_1.default.voucher.findFirst({
        where: { subjectId, voucherNo: { startsWith: closePrefix } },
    });
    if (existing) {
        throw new Error('该月份已结转，不可重复结转');
    }
    // 获取本年利润科目
    const profitAccount = await prisma_1.default.account.findFirst({
        where: { subjectId, code: PROFIT_ACCOUNT_CODE },
    });
    if (!profitAccount) {
        throw new Error('未找到本年利润科目(4103)，无法结转');
    }
    // 获取所有损益类末级科目
    const pnlAccounts = await prisma_1.default.account.findMany({
        where: { subjectId, category: { in: PNL_CATEGORIES }, isLeaf: true },
        orderBy: { code: 'asc' },
    });
    const entries = [];
    for (const acc of pnlAccounts) {
        // 截至月末的累计余额（使结转后余额归零）
        const { debit, credit } = await aggregatePosted(subjectId, acc.id, { lte: monthEnd });
        let balance; // 按自然方向的带符号余额
        if (acc.balanceDirection === 'DEBIT') {
            balance = debit.sub(credit);
        }
        else {
            balance = credit.sub(debit);
        }
        const absBal = balance.abs();
        if (absBal.lte(0))
            continue; // 无余额不结转
        const isIncome = acc.category === 'INCOME';
        let accountDebit = new client_1.Prisma.Decimal(0);
        let accountCredit = new client_1.Prisma.Decimal(0);
        if (isIncome) {
            // 收入类（自然贷方）：余额>=0 借记收入，余额<0 贷记收入
            if (balance.gte(0)) {
                accountDebit = absBal;
            }
            else {
                accountCredit = absBal;
            }
        }
        else {
            // 支出类（自然借方）：余额>=0 贷记支出，余额<0 借记支出
            if (balance.gte(0)) {
                accountCredit = absBal;
            }
            else {
                accountDebit = absBal;
            }
        }
        // 本年利润为反向
        const profitDebit = accountCredit;
        const profitCredit = accountDebit;
        entries.push({
            accountId: acc.id,
            summary: `结转${acc.name}至本年利润`,
            debit: accountDebit,
            credit: accountCredit,
        });
        entries.push({
            accountId: profitAccount.id,
            summary: `结转${acc.name}至本年利润`,
            debit: profitDebit,
            credit: profitCredit,
        });
    }
    if (entries.length === 0) {
        throw new Error('当月损益类科目无余额，无需结转');
    }
    // 生成结转凭证并自动过账
    const voucherNo = await generateVoucherNo(subjectId, monthEnd, '结');
    const voucher = await prisma_1.default.voucher.create({
        data: {
            subjectId,
            voucherNo,
            voucherDate: monthEnd,
            summary: `期末损益结转 ${year}-${pad2(month)}`,
            attachments: 0,
            status: STATUS_POSTED,
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
            entries: {
                create: entries.map((e) => ({
                    accountId: e.accountId,
                    summary: e.summary,
                    debit: e.debit,
                    credit: e.credit,
                })),
            },
        },
        include: { entries: true },
    });
    return serializeVoucher(voucher);
}
// 计算某科目截至某日的余额
// 借方科目余额 = 累计借方 - 累计贷方；贷方科目反之
async function getAccountBalance(subjectId, accountId, upToDate) {
    const account = await prisma_1.default.account.findFirst({ where: { id: accountId, subjectId } });
    if (!account) {
        throw new Error('科目不存在');
    }
    const dateFilter = upToDate ? { lte: new Date(upToDate) } : undefined;
    const { debit, credit } = await aggregatePosted(subjectId, accountId, dateFilter);
    let balance;
    if (account.balanceDirection === 'DEBIT') {
        balance = debit.sub(credit);
    }
    else {
        balance = credit.sub(debit);
    }
    return Number(balance.toString());
}
// 返回该主体所有科目的期初、本期借方发生、本期贷方发生、期末余额
async function getSubjectBalances(subjectId, year, month) {
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const accounts = await prisma_1.default.account.findMany({
        where: { subjectId },
        orderBy: { code: 'asc' },
    });
    const result = [];
    for (const acc of accounts) {
        // 期初：voucherDate < monthStart
        const opening = await aggregatePosted(subjectId, acc.id, { lt: monthStart });
        // 本期发生：monthStart <= voucherDate <= monthEnd
        const period = await aggregatePosted(subjectId, acc.id, { gte: monthStart, lte: monthEnd });
        // 期初余额（按余额方向）
        let openingBalance;
        if (acc.balanceDirection === 'DEBIT') {
            openingBalance = opening.debit.sub(opening.credit);
        }
        else {
            openingBalance = opening.credit.sub(opening.debit);
        }
        // 期末余额 = 期初 + 本期发生（按方向）
        let closingBalance;
        if (acc.balanceDirection === 'DEBIT') {
            closingBalance = openingBalance.add(period.debit).sub(period.credit);
        }
        else {
            closingBalance = openingBalance.add(period.credit).sub(period.debit);
        }
        result.push({
            account: {
                id: acc.id,
                code: acc.code,
                name: acc.name,
                category: acc.category,
                direction: acc.direction,
                balanceDirection: acc.balanceDirection,
                isLeaf: acc.isLeaf,
            },
            openingBalance: Number(openingBalance.toString()),
            periodDebit: Number(period.debit.toString()),
            periodCredit: Number(period.credit.toString()),
            closingBalance: Number(closingBalance.toString()),
        });
    }
    return result;
}
