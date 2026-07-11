"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
exports.list = list;
exports.detail = detail;
exports.post = post;
exports.voidVoucherCtrl = voidVoucherCtrl;
exports.redOffset = redOffset;
exports.update = update;
exports.remove = remove;
exports.periodCloseCtrl = periodCloseCtrl;
exports.balances = balances;
exports.accountBalance = accountBalance;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../utils/prisma"));
const voucherService_1 = require("../services/voucherService");
// ============ 校验 schema ============
// 凭证状态取值
const STATUSES = ['DRAFT', 'POSTED', 'VOID', 'RED_VOID'];
// 分录校验
const entrySchema = zod_1.z.object({
    accountId: zod_1.z.number().int().positive('科目ID无效'),
    summary: zod_1.z.string().max(200).optional().nullable(),
    debit: zod_1.z.number().min(0).default(0),
    credit: zod_1.z.number().min(0).default(0),
});
// 创建凭证校验
const createSchema = zod_1.z.object({
    subjectId: zod_1.z.number().int().positive('主体ID无效'),
    voucherDate: zod_1.z.coerce.date(),
    summary: zod_1.z.string().max(200).optional().nullable(),
    attachments: zod_1.z.number().int().min(0).optional(),
    entries: zod_1.z.array(entrySchema).min(1, '至少一条分录'),
});
// 修改凭证校验（不含 subjectId，沿用原凭证主体）
const updateSchema = zod_1.z.object({
    voucherDate: zod_1.z.coerce.date(),
    summary: zod_1.z.string().max(200).optional().nullable(),
    attachments: zod_1.z.number().int().min(0).optional(),
    entries: zod_1.z.array(entrySchema).min(1, '至少一条分录'),
});
// 红冲校验
const redOffsetSchema = zod_1.z.object({
    reason: zod_1.z.string().max(200).optional(),
});
// 期末结转校验
const periodCloseSchema = zod_1.z.object({
    subjectId: zod_1.z.number().int().positive('主体ID无效'),
    year: zod_1.z.number().int().min(2000).max(2100),
    month: zod_1.z.number().int().min(1).max(12),
});
// ============ 辅助 ============
// 解析分页参数
function parsePagination(req) {
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}
// 业务错误统一返回 400，其他错误透传给全局错误处理（500）
function handleServiceError(res, err) {
    if (err instanceof Error) {
        return res.status(400).json({ error: err.message });
    }
    throw err;
}
// ============ 控制器方法 ============
// POST /api/vouchers  创建凭证（ADMIN/ACCOUNTANT）
async function create(req, res, next) {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { subjectId, voucherDate, summary, attachments, entries } = parsed.data;
        const userId = req.user.id;
        const voucher = await (0, voucherService_1.createVoucher)(subjectId, { voucherDate, summary: summary ?? null, attachments, entries }, userId);
        return res.status(201).json(voucher);
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
// GET /api/vouchers  列表（分页，含 entries 概要），按 voucherDate desc
async function list(req, res, next) {
    try {
        const { skip, take, page, pageSize } = parsePagination(req);
        const where = {};
        if (req.query.subjectId) {
            const sid = parseInt(String(req.query.subjectId), 10);
            if (!Number.isNaN(sid))
                where.subjectId = sid;
        }
        if (req.query.status && STATUSES.includes(req.query.status)) {
            where.status = String(req.query.status);
        }
        if (req.query.from || req.query.to) {
            const voucherDate = {};
            if (req.query.from)
                voucherDate.gte = new Date(String(req.query.from));
            if (req.query.to)
                voucherDate.lte = new Date(String(req.query.to));
            where.voucherDate = voucherDate;
        }
        const [total, vouchers] = await Promise.all([
            prisma_1.default.voucher.count({ where }),
            prisma_1.default.voucher.findMany({
                where,
                orderBy: { voucherDate: 'desc' },
                skip,
                take,
                include: { entries: { include: { account: { select: { code: true, name: true } } } } },
            }),
        ]);
        // 计算每张凭证金额合计（取借方合计），并序列化
        const items = vouchers.map((v) => {
            const serialized = (0, voucherService_1.serializeVoucher)(v);
            const amount = v.entries.reduce((sum, e) => sum.plus(e.debit), new client_1.Prisma.Decimal(0));
            return { ...serialized, amount: Number(amount.toString()) };
        });
        return res.json({ items, total, page, pageSize });
    }
    catch (err) {
        next(err);
    }
}
// GET /api/vouchers/:id  详情（含 entries + account 信息）
async function detail(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的凭证 ID' });
        }
        const voucher = await prisma_1.default.voucher.findUnique({
            where: { id },
            include: {
                entries: {
                    orderBy: { id: 'asc' },
                    include: {
                        account: {
                            select: {
                                id: true,
                                code: true,
                                name: true,
                                category: true,
                                direction: true,
                                balanceDirection: true,
                            },
                        },
                    },
                },
            },
        });
        if (!voucher) {
            return res.status(404).json({ error: '凭证不存在' });
        }
        const serialized = (0, voucherService_1.serializeVoucher)(voucher);
        const amount = voucher.entries.reduce((sum, e) => sum.plus(e.debit), new client_1.Prisma.Decimal(0));
        return res.json({ ...serialized, amount: Number(amount.toString()) });
    }
    catch (err) {
        next(err);
    }
}
// POST /api/vouchers/:id/post  过账（ADMIN/ACCOUNTANT）
async function post(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的凭证 ID' });
        }
        const userId = req.user.id;
        const voucher = await (0, voucherService_1.postVoucher)(id, userId);
        return res.json(voucher);
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// POST /api/vouchers/:id/void  作废（ADMIN/ACCOUNTANT）
async function voidVoucherCtrl(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的凭证 ID' });
        }
        const userId = req.user.id;
        const voucher = await (0, voucherService_1.voidVoucher)(id, userId);
        return res.json(voucher);
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// POST /api/vouchers/:id/red-offset  红冲（ADMIN/ACCOUNTANT）
async function redOffset(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的凭证 ID' });
        }
        const parsed = redOffsetSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const userId = req.user.id;
        const voucher = await (0, voucherService_1.redOffsetVoucher)(id, userId, parsed.data.reason);
        return res.status(201).json(voucher);
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// PUT /api/vouchers/:id  修改凭证（仅 DRAFT 可改）
async function update(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的凭证 ID' });
        }
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { voucherDate, summary, attachments, entries } = parsed.data;
        const userId = req.user.id;
        const voucher = await (0, voucherService_1.updateVoucher)(id, { voucherDate, summary: summary ?? null, attachments, entries }, userId);
        return res.json(voucher);
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// DELETE /api/vouchers/:id  删除（仅 DRAFT 可删）
async function remove(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的凭证 ID' });
        }
        await (0, voucherService_1.deleteVoucher)(id);
        return res.json({ message: '删除成功' });
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// POST /api/vouchers/period-close  期末结转（ADMIN/ACCOUNTANT）
async function periodCloseCtrl(req, res, next) {
    try {
        const parsed = periodCloseSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { subjectId, year, month } = parsed.data;
        const userId = req.user.id;
        const voucher = await (0, voucherService_1.periodClose)(subjectId, year, month, userId);
        return res.status(201).json(voucher);
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// GET /api/vouchers/balances  科目余额表（所有科目期初/本期发生/期末）
async function balances(req, res, next) {
    try {
        const subjectId = parseInt(String(req.query.subjectId), 10);
        const year = parseInt(String(req.query.year), 10);
        const month = parseInt(String(req.query.month), 10);
        if (Number.isNaN(subjectId) || Number.isNaN(year) || Number.isNaN(month)) {
            return res.status(400).json({ error: '请提供 subjectId、year、month 参数' });
        }
        const result = await (0, voucherService_1.getSubjectBalances)(subjectId, year, month);
        return res.json({ items: result });
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// GET /api/vouchers/accounts/:accountId/balance  单科目余额
async function accountBalance(req, res, next) {
    try {
        const accountId = parseInt(String(req.params.accountId), 10);
        if (Number.isNaN(accountId)) {
            return res.status(400).json({ error: '无效的科目 ID' });
        }
        const subjectId = parseInt(String(req.query.subjectId), 10);
        if (Number.isNaN(subjectId)) {
            return res.status(400).json({ error: '请提供 subjectId 参数' });
        }
        const upToDate = req.query.upToDate ? String(req.query.upToDate) : undefined;
        const balance = await (0, voucherService_1.getAccountBalance)(subjectId, accountId, upToDate);
        return res.json({ accountId, subjectId, balance, upToDate: upToDate ?? null });
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
