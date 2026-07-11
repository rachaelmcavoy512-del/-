"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preview = preview;
exports.generate = generate;
exports.pending = pending;
exports.post = post;
exports.unidentified = unidentified;
exports.assign = assign;
const zod_1 = require("zod");
const smartBookService_1 = require("../services/smartBookService");
// ============ 校验 schema ============
const DATA_TYPES = ['INVOICE', 'BANK', 'PAYROLL'];
const previewSchema = zod_1.z.object({
    subjectId: zod_1.z.coerce.number().int().positive('主体ID无效'),
    dataType: zod_1.z.enum(DATA_TYPES).optional(),
});
const generateSchema = zod_1.z.object({
    subjectId: zod_1.z.coerce.number().int().positive('主体ID无效'),
    dataType: zod_1.z.enum(DATA_TYPES).optional(),
});
const postSchema = zod_1.z.object({
    voucherIds: zod_1.z.array(zod_1.z.number().int().positive()).min(1, '至少选择一条凭证'),
});
const assignSchema = zod_1.z.object({
    subjectId: zod_1.z.coerce.number().int().positive('主体ID无效'),
    bankTransactionId: zod_1.z.number().int().positive('流水ID无效'),
    accountId: zod_1.z.number().int().positive('科目ID无效'),
});
// ============ 控制器 ============
// GET /api/smart-book/preview?subjectId=&dataType=
async function preview(req, res, next) {
    try {
        const parsed = previewSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { subjectId, dataType } = parsed.data;
        const result = await (0, smartBookService_1.previewBookings)(subjectId, dataType);
        return res.json(result);
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
// POST /api/smart-book/generate
async function generate(req, res, next) {
    try {
        const parsed = generateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { subjectId, dataType } = parsed.data;
        const result = await (0, smartBookService_1.generateBookings)(subjectId, req.user.id, dataType);
        return res.json(result);
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
// GET /api/smart-book/pending?subjectId=
async function pending(req, res, next) {
    try {
        const subjectId = Number(req.query.subjectId);
        if (Number.isNaN(subjectId)) {
            return res.status(400).json({ error: '主体ID无效' });
        }
        const result = await (0, smartBookService_1.getPendingReview)(subjectId);
        return res.json(result);
    }
    catch (err) {
        next(err);
    }
}
// POST /api/smart-book/post  批量过账
async function post(req, res, next) {
    try {
        const parsed = postSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const result = await (0, smartBookService_1.batchPost)(parsed.data.voucherIds, req.user.id);
        return res.json(result);
    }
    catch (err) {
        next(err);
    }
}
// GET /api/smart-book/unidentified?subjectId=
async function unidentified(req, res, next) {
    try {
        const subjectId = Number(req.query.subjectId);
        if (Number.isNaN(subjectId)) {
            return res.status(400).json({ error: '主体ID无效' });
        }
        const result = await (0, smartBookService_1.getUnidentified)(subjectId);
        return res.json(result);
    }
    catch (err) {
        next(err);
    }
}
// POST /api/smart-book/assign  人工指定科目
async function assign(req, res, next) {
    try {
        const parsed = assignSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { subjectId, bankTransactionId, accountId } = parsed.data;
        const voucher = await (0, smartBookService_1.assignManualEntry)(subjectId, bankTransactionId, accountId, req.user.id);
        return res.status(201).json(voucher);
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
