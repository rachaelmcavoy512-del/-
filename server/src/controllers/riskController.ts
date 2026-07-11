// 风险监控控制器（Task7）
// 处理 HTTP 请求/响应，zod 校验 body，调用 riskScanService 与 prisma 完成业务逻辑
import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { scanSubject, rescanAll } from '../services/riskScanService';
import { generateReport } from '../services/riskReportService';
import {
  generateAdjustmentVoucher,
  postAdjustmentAndResolve,
} from '../services/adjustmentService';

// ============ 取值常量 ============

const LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
const EVENT_STATUSES = ['PENDING', 'IN_PROGRESS', 'RESOLVED', 'IGNORED'] as const;
const REMEDIATION_STATUSES = ['TODO', 'DOING', 'DONE'] as const;
const CATEGORIES = ['VAT', 'CIT', 'INVOICE', 'FUND', 'RELATED', 'OTHER'] as const;

// ============ 校验 schema ============

// 更新指标阈值/启用状态
const updateIndicatorSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  category: z.enum(CATEGORIES).optional(),
  thresholdHigh: z.string().optional(),
  thresholdMedium: z.string().optional(),
  thresholdLow: z.string().optional().nullable(),
  severity: z.enum(['DEFAULT_HIGH', 'DEFAULT_MEDIUM']).optional(),
  enabled: z.boolean().optional(),
});

// 手动触发扫描
const scanSchema = z.object({
  subjectId: z.number().int().positive('主体ID无效'),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'period 格式应为 YYYY-MM')
    .optional()
    .nullable(),
});

// 重新扫描
const rescanSchema = z.object({
  subjectId: z.number().int().positive('主体ID无效').optional().nullable(),
});

// 更新事件状态
const updateEventStatusSchema = z.object({
  status: z.enum(['RESOLVED', 'IGNORED', 'IN_PROGRESS']),
  resolution: z.string().max(500).optional().nullable(),
});

// 创建整改任务
const createRemediationSchema = z.object({
  assigneeId: z.number().int().positive('指派人ID无效'),
  dueDate: z.coerce.date().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

// 更新整改任务状态
const updateRemediationSchema = z.object({
  status: z.enum(REMEDIATION_STATUSES),
  note: z.string().max(500).optional().nullable(),
});

// ============ 辅助 ============

// 解析分页参数
function parsePagination(req: Request) {
  const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
  const pageSizeRaw = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

// 序列化风险事件
function serializeEvent(event: Prisma.RiskEventGetPayload<{
  include: { indicator: true; subject: true };
}>) {
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
async function maybeAutoResolveEvent(eventId: number, userId: number) {
  const remediations = await prisma.riskRemediation.findMany({
    where: { eventId },
    select: { status: true },
  });
  if (remediations.length === 0) return;
  const allDone = remediations.every((r) => r.status === 'DONE');
  if (allDone) {
    await prisma.riskEvent.update({
      where: { id: eventId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy: userId,
        resolution: '所有整改任务已完成，自动标记为已整改',
      },
    });
  } else {
    // 存在进行中的整改任务，事件置为整改中
    const hasDoing = remediations.some((r) => r.status !== 'TODO');
    const event = await prisma.riskEvent.findUnique({ where: { id: eventId } });
    if (event && event.status === 'PENDING' && hasDoing) {
      await prisma.riskEvent.update({
        where: { id: eventId },
        data: { status: 'IN_PROGRESS' },
      });
    }
  }
}

// ============ 指标库 ============

// GET /api/risks/indicators  指标库列表
export async function listIndicators(_req: Request, res: Response, next: NextFunction) {
  try {
    const indicators = await prisma.riskIndicator.findMany({
      orderBy: { id: 'asc' },
    });
    return res.json(indicators);
  } catch (err) {
    next(err);
  }
}

// PUT /api/risks/indicators/:id  更新指标阈值/启用状态（仅 ADMIN）
export async function updateIndicator(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: '无效的指标 ID' });
    }
    const parsed = updateIndicatorSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const existing = await prisma.riskIndicator.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: '风险指标不存在' });
    }
    const data: Prisma.RiskIndicatorUpdateInput = {};
    const d = parsed.data;
    if (d.name !== undefined) data.name = d.name;
    if (d.description !== undefined) data.description = d.description ?? null;
    if (d.category !== undefined) data.category = d.category;
    if (d.thresholdHigh !== undefined) data.thresholdHigh = d.thresholdHigh;
    if (d.thresholdMedium !== undefined) data.thresholdMedium = d.thresholdMedium;
    if (d.thresholdLow !== undefined) data.thresholdLow = d.thresholdLow ?? null;
    if (d.severity !== undefined) data.severity = d.severity;
    if (d.enabled !== undefined) data.enabled = d.enabled;
    const updated = await prisma.riskIndicator.update({ where: { id }, data });
    return res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ============ 扫描 ============

// POST /api/risks/scan  手动触发扫描
export async function scan(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const { subjectId, period } = parsed.data;
    const summary = await scanSubject(subjectId, undefined, period ?? null);
    return res.json(summary);
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

// POST /api/risks/rescan  重新扫描（仅 ADMIN）
export async function rescan(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = rescanSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const { subjectId } = parsed.data;
    const results = await rescanAll(subjectId ?? undefined);
    return res.json({ results });
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

// ============ 风险事件 ============

// GET /api/risks/events  风险事件列表
// query: subjectId / level / status / indicatorId / page / pageSize
export async function listEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const { skip, take, page, pageSize } = parsePagination(req);
    const where: Prisma.RiskEventWhereInput = {};
    if (req.query.subjectId) {
      const sid = Number(req.query.subjectId);
      if (!Number.isNaN(sid)) where.subjectId = sid;
    }
    if (req.query.level && LEVELS.includes(req.query.level as (typeof LEVELS)[number])) {
      where.level = String(req.query.level);
    }
    if (req.query.status && EVENT_STATUSES.includes(req.query.status as (typeof EVENT_STATUSES)[number])) {
      where.status = String(req.query.status);
    }
    if (req.query.indicatorId) {
      const iid = Number(req.query.indicatorId);
      if (!Number.isNaN(iid)) where.indicatorId = iid;
    }

    const [total, events] = await Promise.all([
      prisma.riskEvent.count({ where }),
      prisma.riskEvent.findMany({
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
  } catch (err) {
    next(err);
  }
}

// GET /api/risks/events/:id  事件详情（含整改任务）
export async function getEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: '无效的事件 ID' });
    }
    const event = await prisma.riskEvent.findUnique({
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
  } catch (err) {
    next(err);
  }
}

// PUT /api/risks/events/:id/status  更新事件状态
export async function updateEventStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: '无效的事件 ID' });
    }
    const parsed = updateEventStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const existing = await prisma.riskEvent.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: '风险事件不存在' });
    }
    const { status, resolution } = parsed.data;
    const data: Prisma.RiskEventUpdateInput = { status };
    if (status === 'RESOLVED' || status === 'IGNORED') {
      data.resolvedAt = new Date();
      data.resolvedBy = req.user!.id;
      if (resolution !== undefined) data.resolution = resolution ?? null;
    }
    if (status === 'IN_PROGRESS' && resolution !== undefined) {
      data.resolution = resolution ?? null;
    }
    const updated = await prisma.riskEvent.update({ where: { id }, data });
    return res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ============ 整改任务 ============

// POST /api/risks/events/:id/remediations  创建整改任务
export async function createRemediation(req: Request, res: Response, next: NextFunction) {
  try {
    const eventId = Number(req.params.id);
    if (Number.isNaN(eventId)) {
      return res.status(400).json({ error: '无效的事件 ID' });
    }
    const parsed = createRemediationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const event = await prisma.riskEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: '风险事件不存在' });
    }
    const { assigneeId, dueDate, note } = parsed.data;
    const assignee = await prisma.user.findUnique({ where: { id: assigneeId } });
    if (!assignee) {
      return res.status(400).json({ error: '指派用户不存在' });
    }
    const remediation = await prisma.riskRemediation.create({
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
      await prisma.riskEvent.update({
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
  } catch (err) {
    next(err);
  }
}

// GET /api/risks/events/:id/remediations  某事件的整改任务列表
export async function listRemediations(req: Request, res: Response, next: NextFunction) {
  try {
    const eventId = Number(req.params.id);
    if (Number.isNaN(eventId)) {
      return res.status(400).json({ error: '无效的事件 ID' });
    }
    const event = await prisma.riskEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: '风险事件不存在' });
    }
    const remediations = await prisma.riskRemediation.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
    return res.json(
      remediations.map((r) => ({
        ...r,
        dueDate: r.dueDate ? r.dueDate.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    next(err);
  }
}

// PUT /api/risks/remediations/:id  更新整改任务状态
// 整改任务全部完成时自动将事件置为 RESOLVED
export async function updateRemediation(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: '无效的整改任务 ID' });
    }
    const parsed = updateRemediationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const existing = await prisma.riskRemediation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: '整改任务不存在' });
    }
    const { status, note } = parsed.data;
    const data: Prisma.RiskRemediationUpdateInput = { status };
    if (note !== undefined) data.note = note ?? null;
    const updated = await prisma.riskRemediation.update({ where: { id }, data });
    // 整改任务状态变更后，检查事件是否可自动结案
    await maybeAutoResolveEvent(existing.eventId, req.user!.id);
    return res.json({
      ...updated,
      dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

// ============ 整改指派人 ============

// GET /api/risks/users  获取可指派的用户列表（用于整改任务下拉选择）
// 仅返回 id/username/role，供前端整改任务表单的指派人下拉使用
export async function listAssignees(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true },
      orderBy: { id: 'asc' },
    });
    return res.json(users);
  } catch (err) {
    next(err);
  }
}

// ============ 风险看板 ============

// GET /api/risks/dashboard  风险看板
// query: subjectId?
// 返回 { totalEvents, byLevel:{high,medium,low}, byStatus:{pending,inProgress,resolved,ignored}, remediationRate, trend:[{period,count}] }
export async function dashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const where: Prisma.RiskEventWhereInput = {};
    if (req.query.subjectId) {
      const sid = Number(req.query.subjectId);
      if (!Number.isNaN(sid)) where.subjectId = sid;
    }

    // 总数与按等级/状态分组（仅统计未忽略事件计入整改率分母更合理，这里按全部统计）
    const events = await prisma.riskEvent.findMany({
      where,
      select: { level: true, status: true, detectedAt: true },
    });
    const totalEvents = events.length;
    const byLevel = { high: 0, medium: 0, low: 0 };
    const byStatus = { pending: 0, inProgress: 0, resolved: 0, ignored: 0 };
    for (const e of events) {
      if (e.level === 'HIGH') byLevel.high++;
      else if (e.level === 'MEDIUM') byLevel.medium++;
      else if (e.level === 'LOW') byLevel.low++;
      if (e.status === 'PENDING') byStatus.pending++;
      else if (e.status === 'IN_PROGRESS') byStatus.inProgress++;
      else if (e.status === 'RESOLVED') byStatus.resolved++;
      else if (e.status === 'IGNORED') byStatus.ignored++;
    }
    // 整改率 = 已整改 / (已整改 + 待处理 + 整改中)，忽略不计入
    const denominator = byStatus.resolved + byStatus.pending + byStatus.inProgress;
    const remediationRate = denominator > 0 ? byStatus.resolved / denominator : 0;

    // 近 6 个月每月事件数（按 detectedAt 归月份）
    const now = new Date();
    const trend: Array<{ period: string; count: number }> = [];
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
      if (t) t.count++;
    }

    return res.json({
      totalEvents,
      byLevel,
      byStatus,
      remediationRate: Number(remediationRate.toFixed(4)),
      trend,
    });
  } catch (err) {
    next(err);
  }
}

// ============ 风险体检报告 ============

// GET /api/risks/report?subjectId=&period=
// 生成风险体检报告（含大白话描述 + 改正步骤 + 总体评级）
export async function report(req: Request, res: Response, next: NextFunction) {
  try {
    const subjectId = Number(req.query.subjectId);
    if (Number.isNaN(subjectId)) {
      return res.status(400).json({ error: '主体ID无效' });
    }
    const period = req.query.period ? String(req.query.period) : undefined;
    const result = await generateReport(subjectId, period);
    return res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

// ============ 一键整改 ============

// POST /api/risks/events/:id/adjustment-voucher  生成整改凭证
// body: { postImmediately?: boolean }
export async function generateAdjustmentVoucherCtrl(req: Request, res: Response, next: NextFunction) {
  try {
    const eventId = Number(req.params.id);
    if (Number.isNaN(eventId)) {
      return res.status(400).json({ error: '无效的事件 ID' });
    }
    const userId = req.user!.id;
    const result = await generateAdjustmentVoucher(eventId, userId);
    // 若要求立即过账
    if (req.body?.postImmediately) {
      const posted = await postAdjustmentAndResolve(eventId, userId);
      return res.json({ voucher: posted, adjustAmount: result.adjustAmount, posted: true });
    }
    return res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

// POST /api/risks/events/:id/resolve  过账调整凭证并结案
export async function resolveEventCtrl(req: Request, res: Response, next: NextFunction) {
  try {
    const eventId = Number(req.params.id);
    if (Number.isNaN(eventId)) {
      return res.status(400).json({ error: '无效的事件 ID' });
    }
    const voucher = await postAdjustmentAndResolve(eventId, req.user!.id);
    return res.json({ voucher, message: '整改凭证已过账，事件已结案' });
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}
