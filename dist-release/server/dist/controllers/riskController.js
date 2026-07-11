"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listIndicators = listIndicators;
exports.updateIndicator = updateIndicator;
exports.scan = scan;
exports.rescan = rescan;
exports.listEvents = listEvents;
exports.getEvent = getEvent;
exports.updateEventStatus = updateEventStatus;
exports.createRemediation = createRemediation;
exports.listRemediations = listRemediations;
exports.updateRemediation = updateRemediation;
exports.listAssignees = listAssignees;
exports.dashboard = dashboard;
exports.report = report;
exports.generateAdjustmentVoucherCtrl = generateAdjustmentVoucherCtrl;
exports.resolveEventCtrl = resolveEventCtrl;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../utils/prisma"));
const riskScanService_1 = require("../services/riskScanService");
const riskReportService_1 = require("../services/riskReportService");
const adjustmentService_1 = require("../services/adjustmentService");
// ============ 取值常量 ============
const LEVELS = ['HIGH', 'MEDIUM', 'LOW'];
const EVENT_STATUSES = ['PENDING', 'IN_PROGRESS', 'RESOLVED', 'IGNORED'];
const REMEDIATION_STATUSES = ['TODO', 'DOING', 'DONE'];
const CATEGORIES = ['VAT', 'CIT', 'INVOICE', 'FUND', 'RELATED', 'OTHER'];
// ============ 校验 schema ============
// 更新指标阈值/启用状态
const updateIndicatorSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    description: zod_1.z.string().optional().nullable(),
    category: zod_1.z.enum(CATEGORIES).optional(),
    thresholdHigh: zod_1.z.string().optional(),
    thresholdMedium: zod_1.z.string().optional(),
    thresholdLow: zod_1.z.string().optional().nullable(),
    severity: zod_1.z.enum(['DEFAULT_HIGH', 'DEFAULT_MEDIUM']).optional(),
    enabled: zod_1.z.boolean().optional(),
});
// 手动触发扫描
const scanSchema = zod_1.z.object({
    subjectId: zod_1.z.number().int().positive('主体ID无效'),
    period: zod_1.z
        .string()
        .regex(/^\d{4}-\d{2}$/, 'period 格式应为 YYYY-MM')
        .optional()
        .nullable(),
});
// 重新扫描
const rescanSchema = zod_1.z.object({
    subjectId: zod_1.z.number().int().positive('主体ID无效').optional().nullable(),
});
// 更新事件状态
const updateEventStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['RESOLVED', 'IGNORED', 'IN_PROGRESS']),
    resolution: zod_1.z.string().max(500).optional().nullable(),
});
// 创建整改任务
const createRemediationSchema = zod_1.z.object({
    assigneeId: zod_1.z.number().int().positive('指派人ID无效'),
    dueDate: zod_1.z.coerce.date().optional().nullable(),
    note: zod_1.z.string().max(500).optional().nullable(),
});
// 更新整改任务状态
const updateRemediationSchema = zod_1.z.object({
    status: zod_1.z.enum(REMEDIATION_STATUSES),
    note: zod_1.z.string().max(500).optional().nullable(),
});
// ============ 辅助 ============
// 解析分页参数
function parsePagination(req) {
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}
// 序列化风险事件
function serializeEvent(event) {
    return {
        id: event.id,
        subjectId: event.subjectId,
        indicatorId: event.indicatorId,
        period: event.period,
        level: event.level,
        metricValue: event.metricValue,
        thresholdValue: event.thresholdValue,
        description: event.description,
        suggestion: event.suggestion,
        status: event.status,
        detectedAt: event.detectedAt.toISOString(),
        resolvedAt: event.resolvedAt ? event.resolvedAt.toISOString() : null,
        resolvedBy: event.resolvedBy,
        resolution: event.resolution,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        actionableSteps: event.actionableSteps,
        adjustmentVoucherId: event.adjustmentVoucherId,
        indicator: {
            id: event.indicator.id,
            code: event.indicator.code,
            name: event.indicator.name,
            category: event.indicator.category,
            description: event.indicator.description,
        },
        subject: {
            id: event.subject.id,
            name: event.subject.name,
            taxNumber: event.subject.taxNumber,
        },
    };
}
// 整改任务完成后，若事件下所有 remediation 都 DONE，则自动将事件置为 RESOLVED
async function maybeAutoResolveEvent(eventId, userId) {
    const remediations = await prisma_1.default.riskRemediation.findMany({
        where: { eventId },
        select: { status: true },
    });
    if (remediations.length === 0)
        return;
    const allDone = remediations.every((r) => r.status === 'DONE');
    if (allDone) {
        await prisma_1.default.riskEvent.update({
            where: { id: eventId },
            data: {
                status: 'RESOLVED',
                resolvedAt: new Date(),
                resolvedBy: userId,
                resolution: '所有整改任务已完成，自动标记为已整改',
            },
        });
    }
    else {
        // 存在进行中的整改任务，事件置为整改中
        const hasDoing = remediations.some((r) => r.status !== 'TODO');
        const event = await prisma_1.default.riskEvent.findUnique({ where: { id: eventId } });
        if (event && event.status === 'PENDING' && hasDoing) {
            await prisma_1.default.riskEvent.update({
                where: { id: eventId },
                data: { status: 'IN_PROGRESS' },
            });
        }
    }
}
// ============ 指标库 ============
// GET /api/risks/indicators  指标库列表
async function listIndicators(_req, res, next) {
    try {
        const indicators = await prisma_1.default.riskIndicator.findMany({
            orderBy: { id: 'asc' },
        });
        return res.json(indicators);
    }
    catch (err) {
        next(err);
    }
}
// PUT /api/risks/indicators/:id  更新指标阈值/启用状态（仅 ADMIN）
async function updateIndicator(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的指标 ID' });
        }
        const parsed = updateIndicatorSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const existing = await prisma_1.default.riskIndicator.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: '风险指标不存在' });
        }
        const data = {};
        const d = parsed.data;
        if (d.name !== undefined)
            data.name = d.name;
        if (d.description !== undefined)
            data.description = d.description ?? null;
        if (d.category !== undefined)
            data.category = d.category;
        if (d.thresholdHigh !== undefined)
            data.thresholdHigh = d.thresholdHigh;
        if (d.thresholdMedium !== undefined)
            data.thresholdMedium = d.thresholdMedium;
        if (d.thresholdLow !== undefined)
            data.thresholdLow = d.thresholdLow ?? null;
        if (d.severity !== undefined)
            data.severity = d.severity;
        if (d.enabled !== undefined)
            data.enabled = d.enabled;
        const updated = await prisma_1.default.riskIndicator.update({ where: { id }, data });
        return res.json(updated);
    }
    catch (err) {
        next(err);
    }
}
// ============ 扫描 ============
// POST /api/risks/scan  手动触发扫描
async function scan(req, res, next) {
    try {
        const parsed = scanSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { subjectId, period } = parsed.data;
        const summary = await (0, riskScanService_1.scanSubject)(subjectId, undefined, period ?? null);
        return res.json(summary);
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
// POST /api/risks/rescan  重新扫描（仅 ADMIN）
async function rescan(req, res, next) {
    try {
        const parsed = rescanSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { subjectId } = parsed.data;
        const results = await (0, riskScanService_1.rescanAll)(subjectId ?? undefined);
        return res.json({ results });
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
// ============ 风险事件 ============
// GET /api/risks/events  风险事件列表
// query: subjectId / level / status / indicatorId / page / pageSize
async function listEvents(req, res, next) {
    try {
        const { skip, take, page, pageSize } = parsePagination(req);
        const where = {};
        if (req.query.subjectId) {
            const sid = Number(req.query.subjectId);
            if (!Number.isNaN(sid))
                where.subjectId = sid;
        }
        if (req.query.level && LEVELS.includes(req.query.level)) {
            where.level = String(req.query.level);
        }
        if (req.query.status && EVENT_STATUSES.includes(req.query.status)) {
            where.status = String(req.query.status);
        }
        if (req.query.indicatorId) {
            const iid = Number(req.query.indicatorId);
            if (!Number.isNaN(iid))
                where.indicatorId = iid;
        }
        const [total, events] = await Promise.all([
            prisma_1.default.riskEvent.count({ where }),
            prisma_1.default.riskEvent.findMany({
                where,
                orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
                skip,
                take,
                include: { indicator: true, subject: true },
            }),
        ]);
        return res.json({
            items: events.map(serializeEvent),
            total,
            page,
            pageSize,
        });
    }
    catch (err) {
        next(err);
    }
}
// GET /api/risks/events/:id  事件详情（含整改任务）
async function getEvent(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的事件 ID' });
        }
        const event = await prisma_1.default.riskEvent.findUnique({
            where: { id },
            include: {
                indicator: true,
                subject: true,
                remediations: { orderBy: { createdAt: 'asc' } },
            },
        });
        if (!event) {
            return res.status(404).json({ error: '风险事件不存在' });
        }
        return res.json({
            ...serializeEvent(event),
            remediations: event.remediations.map((r) => ({
                ...r,
                dueDate: r.dueDate ? r.dueDate.toISOString() : null,
                createdAt: r.createdAt.toISOString(),
                updatedAt: r.updatedAt.toISOString(),
            })),
        });
    }
    catch (err) {
        next(err);
    }
}
// PUT /api/risks/events/:id/status  更新事件状态
async function updateEventStatus(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的事件 ID' });
        }
        const parsed = updateEventStatusSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const existing = await prisma_1.default.riskEvent.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: '风险事件不存在' });
        }
        const { status, resolution } = parsed.data;
        const data = { status };
        if (status === 'RESOLVED' || status === 'IGNORED') {
            data.resolvedAt = new Date();
            data.resolvedBy = req.user.id;
            if (resolution !== undefined)
                data.resolution = resolution ?? null;
        }
        if (status === 'IN_PROGRESS' && resolution !== undefined) {
            data.resolution = resolution ?? null;
        }
        const updated = await prisma_1.default.riskEvent.update({ where: { id }, data });
        return res.json(updated);
    }
    catch (err) {
        next(err);
    }
}
// ============ 整改任务 ============
// POST /api/risks/events/:id/remediations  创建整改任务
async function createRemediation(req, res, next) {
    try {
        const eventId = Number(req.params.id);
        if (Number.isNaN(eventId)) {
            return res.status(400).json({ error: '无效的事件 ID' });
        }
        const parsed = createRemediationSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const event = await prisma_1.default.riskEvent.findUnique({ where: { id: eventId } });
        if (!event) {
            return res.status(404).json({ error: '风险事件不存在' });
        }
        const { assigneeId, dueDate, note } = parsed.data;
        const assignee = await prisma_1.default.user.findUnique({ where: { id: assigneeId } });
        if (!assignee) {
            return res.status(400).json({ error: '指派用户不存在' });
        }
        const remediation = await prisma_1.default.riskRemediation.create({
            data: {
                eventId,
                assigneeId,
                dueDate: dueDate ?? null,
                note: note ?? null,
                status: 'TODO',
            },
        });
        // 事件若有整改任务且原为 PENDING，置为整改中
        if (event.status === 'PENDING') {
            await prisma_1.default.riskEvent.update({
                where: { id: eventId },
                data: { status: 'IN_PROGRESS' },
            });
        }
        return res.status(201).json({
            ...remediation,
            dueDate: remediation.dueDate ? remediation.dueDate.toISOString() : null,
            createdAt: remediation.createdAt.toISOString(),
            updatedAt: remediation.updatedAt.toISOString(),
        });
    }
    catch (err) {
        next(err);
    }
}
// GET /api/risks/events/:id/remediations  某事件的整改任务列表
async function listRemediations(req, res, next) {
    try {
        const eventId = Number(req.params.id);
        if (Number.isNaN(eventId)) {
            return res.status(400).json({ error: '无效的事件 ID' });
        }
        const event = await prisma_1.default.riskEvent.findUnique({ where: { id: eventId } });
        if (!event) {
            return res.status(404).json({ error: '风险事件不存在' });
        }
        const remediations = await prisma_1.default.riskRemediation.findMany({
            where: { eventId },
            orderBy: { createdAt: 'asc' },
        });
        return res.json(remediations.map((r) => ({
            ...r,
            dueDate: r.dueDate ? r.dueDate.toISOString() : null,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
        })));
    }
    catch (err) {
        next(err);
    }
}
// PUT /api/risks/remediations/:id  更新整改任务状态
// 整改任务全部完成时自动将事件置为 RESOLVED
async function updateRemediation(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的整改任务 ID' });
        }
        const parsed = updateRemediationSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const existing = await prisma_1.default.riskRemediation.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: '整改任务不存在' });
        }
        const { status, note } = parsed.data;
        const data = { status };
        if (note !== undefined)
            data.note = note ?? null;
        const updated = await prisma_1.default.riskRemediation.update({ where: { id }, data });
        // 整改任务状态变更后，检查事件是否可自动结案
        await maybeAutoResolveEvent(existing.eventId, req.user.id);
        return res.json({
            ...updated,
            dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        });
    }
    catch (err) {
        next(err);
    }
}
// ============ 整改指派人 ============
// GET /api/risks/users  获取可指派的用户列表（用于整改任务下拉选择）
// 仅返回 id/username/role，供前端整改任务表单的指派人下拉使用
async function listAssignees(_req, res, next) {
    try {
        const users = await prisma_1.default.user.findMany({
            select: { id: true, username: true, role: true },
            orderBy: { id: 'asc' },
        });
        return res.json(users);
    }
    catch (err) {
        next(err);
    }
}
// ============ 风险看板 ============
// GET /api/risks/dashboard  风险看板
// query: subjectId?
// 返回 { totalEvents, byLevel:{high,medium,low}, byStatus:{pending,inProgress,resolved,ignored}, remediationRate, trend:[{period,count}] }
async function dashboard(req, res, next) {
    try {
        const where = {};
        if (req.query.subjectId) {
            const sid = Number(req.query.subjectId);
            if (!Number.isNaN(sid))
                where.subjectId = sid;
        }
        // 总数与按等级/状态分组（仅统计未忽略事件计入整改率分母更合理，这里按全部统计）
        const events = await prisma_1.default.riskEvent.findMany({
            where,
            select: { level: true, status: true, detectedAt: true },
        });
        const totalEvents = events.length;
        const byLevel = { high: 0, medium: 0, low: 0 };
        const byStatus = { pending: 0, inProgress: 0, resolved: 0, ignored: 0 };
        for (const e of events) {
            if (e.level === 'HIGH')
                byLevel.high++;
            else if (e.level === 'MEDIUM')
                byLevel.medium++;
            else if (e.level === 'LOW')
                byLevel.low++;
            if (e.status === 'PENDING')
                byStatus.pending++;
            else if (e.status === 'IN_PROGRESS')
                byStatus.inProgress++;
            else if (e.status === 'RESOLVED')
                byStatus.resolved++;
            else if (e.status === 'IGNORED')
                byStatus.ignored++;
        }
        // 整改率 = 已整改 / (已整改 + 待处理 + 整改中)，忽略不计入
        const denominator = byStatus.resolved + byStatus.pending + byStatus.inProgress;
        const remediationRate = denominator > 0 ? byStatus.resolved / denominator : 0;
        // 近 6 个月每月事件数（按 detectedAt 归月份）
        const now = new Date();
        const trend = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            trend.push({ period, count: 0 });
        }
        const trendMap = new Map(trend.map((t) => [t.period, t]));
        for (const e of events) {
            const d = e.detectedAt;
            const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const t = trendMap.get(period);
            if (t)
                t.count++;
        }
        return res.json({
            totalEvents,
            byLevel,
            byStatus,
            remediationRate: Number(remediationRate.toFixed(4)),
            trend,
        });
    }
    catch (err) {
        next(err);
    }
}
// ============ 风险体检报告 ============
// GET /api/risks/report?subjectId=&period=
// 生成风险体检报告（含大白话描述 + 改正步骤 + 总体评级）
async function report(req, res, next) {
    try {
        const subjectId = Number(req.query.subjectId);
        if (Number.isNaN(subjectId)) {
            return res.status(400).json({ error: '主体ID无效' });
        }
        const period = req.query.period ? String(req.query.period) : undefined;
        const result = await (0, riskReportService_1.generateReport)(subjectId, period);
        return res.json(result);
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
// ============ 一键整改 ============
// POST /api/risks/events/:id/adjustment-voucher  生成整改凭证
// body: { postImmediately?: boolean }
async function generateAdjustmentVoucherCtrl(req, res, next) {
    try {
        const eventId = Number(req.params.id);
        if (Number.isNaN(eventId)) {
            return res.status(400).json({ error: '无效的事件 ID' });
        }
        const userId = req.user.id;
        const result = await (0, adjustmentService_1.generateAdjustmentVoucher)(eventId, userId);
        // 若要求立即过账
        if (req.body?.postImmediately) {
            const posted = await (0, adjustmentService_1.postAdjustmentAndResolve)(eventId, userId);
            return res.json({ voucher: posted, adjustAmount: result.adjustAmount, posted: true });
        }
        return res.json(result);
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
// POST /api/risks/events/:id/resolve  过账调整凭证并结案
async function resolveEventCtrl(req, res, next) {
    try {
        const eventId = Number(req.params.id);
        if (Number.isNaN(eventId)) {
            return res.status(400).json({ error: '无效的事件 ID' });
        }
        const voucher = await (0, adjustmentService_1.postAdjustmentAndResolve)(eventId, req.user.id);
        return res.json({ voucher, message: '整改凭证已过账，事件已结案' });
    }
    catch (err) {
        if (err instanceof Error) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}
