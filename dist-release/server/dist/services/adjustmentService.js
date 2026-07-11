"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAdjustmentVoucher = generateAdjustmentVoucher;
exports.postAdjustmentAndResolve = postAdjustmentAndResolve;
// 一键整改服务（新手友好）
// 针对可自动整改的风险事件（VAT_TAX_BURDEN / EXCESS_CREDIT）生成调整凭证
// 调整逻辑：借6401主营业务成本 贷22210102进项税额，金额=进项科目余额×30%
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../utils/prisma"));
const voucherService_1 = require("./voucherService");
// 计入余额的凭证状态
const POSTED_STATUSES = ['POSTED', 'RED_VOID'];
// 获取进项税额科目余额（借方余额）
async function getInputTaxBalance(subjectId) {
    const account = await prisma_1.default.account.findFirst({
        where: { subjectId, code: '22210102' },
    });
    if (!account) {
        throw new Error('未找到进项税额科目(22210102)，仅一般纳税人支持一键整改');
    }
    // 聚合已过账凭证的借/贷方
    const result = await prisma_1.default.voucherEntry.aggregate({
        _sum: { debit: true, credit: true },
        where: {
            accountId: account.id,
            voucher: { subjectId, status: { in: POSTED_STATUSES } },
        },
    });
    const debit = result._sum.debit ?? new client_1.Prisma.Decimal(0);
    const credit = result._sum.credit ?? new client_1.Prisma.Decimal(0);
    // 进项税额为借方科目，余额 = 借方 - 贷方
    const balance = Number(debit.sub(credit).toString());
    return { accountId: account.id, balance };
}
// 生成调整凭证：借6401主营业务成本 贷22210102进项税额，金额=进项科目余额×30%
async function generateAdjustmentVoucher(eventId, userId) {
    const event = await prisma_1.default.riskEvent.findUnique({
        where: { id: eventId },
        include: { indicator: true },
    });
    if (!event) {
        throw new Error('风险事件不存在');
    }
    // 校验事件状态：仅 PENDING/IN_PROGRESS 可生成
    if (event.status !== 'PENDING' && event.status !== 'IN_PROGRESS') {
        throw new Error('当前事件状态不可生成整改凭证');
    }
    // 校验是否已生成
    if (event.adjustmentVoucherId) {
        throw new Error('该事件已生成整改凭证');
    }
    // 仅支持 VAT_TAX_BURDEN / EXCESS_CREDIT
    if (event.indicator.code !== 'VAT_TAX_BURDEN' && event.indicator.code !== 'EXCESS_CREDIT') {
        throw new Error('该风险指标不支持一键整改');
    }
    // 获取进项税额科目余额
    const { accountId: inputTaxAccountId, balance: inputTaxBalance } = await getInputTaxBalance(event.subjectId);
    if (inputTaxBalance <= 0) {
        throw new Error('进项税额科目余额为0，无法生成调整凭证');
    }
    // 调整金额 = 进项科目余额 × 30%
    const adjustAmount = Number((inputTaxBalance * 0.3).toFixed(2));
    // 获取主营业务成本科目
    const costAccount = await prisma_1.default.account.findFirst({
        where: { subjectId: event.subjectId, code: '6401' },
    });
    if (!costAccount) {
        throw new Error('未找到主营业务成本科目(6401)');
    }
    // 创建调整凭证（草稿）
    const voucher = await (0, voucherService_1.createVoucher)(event.subjectId, {
        voucherDate: new Date().toISOString().slice(0, 10),
        summary: `风险整改-${event.indicator.name}（进项转出30%）`,
        entries: [
            { accountId: costAccount.id, summary: '进项税额转出', debit: adjustAmount, credit: 0 },
            { accountId: inputTaxAccountId, summary: '进项税额转出', debit: 0, credit: adjustAmount },
        ],
    }, userId);
    // 更新事件：记录调整凭证 + 步骤说明 + 状态置为整改中
    const actionableSteps = JSON.stringify([
        '1.系统已自动生成进项税额转出凭证（借：主营业务成本 贷：进项税额）',
        `2.转出金额 = 进项税额余额(${inputTaxBalance.toFixed(2)}) × 30% = ${adjustAmount.toFixed(2)}`,
        '3.请过账该调整凭证以完成整改',
        '4.过账后事件将自动标记为已整改',
    ]);
    await prisma_1.default.riskEvent.update({
        where: { id: eventId },
        data: {
            adjustmentVoucherId: voucher.id,
            actionableSteps,
            status: 'IN_PROGRESS',
        },
    });
    return { voucher, adjustAmount, inputTaxBalance };
}
// 过账调整凭证并将事件标记为已整改
async function postAdjustmentAndResolve(eventId, userId) {
    const event = await prisma_1.default.riskEvent.findUnique({ where: { id: eventId } });
    if (!event) {
        throw new Error('风险事件不存在');
    }
    if (!event.adjustmentVoucherId) {
        throw new Error('该事件尚未生成整改凭证');
    }
    // 过账调整凭证
    const voucher = await (0, voucherService_1.postVoucher)(event.adjustmentVoucherId, userId);
    // 事件状态置为已整改
    await prisma_1.default.riskEvent.update({
        where: { id: eventId },
        data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedBy: userId,
            resolution: '一键整改：已生成并过账进项税额转出凭证',
        },
    });
    return voucher;
}
