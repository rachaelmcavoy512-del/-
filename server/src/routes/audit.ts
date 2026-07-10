import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import auditRepo from '../repositories/auditRepo';
import { verifyAuditChain } from '../middlewares/audit';

const router = Router();

// 所有审计日志接口都需要登录
router.use(authenticate);

// AUDITOR 仅可见的字段：不含 hash / prevHash / seq
const AUDITOR_FIELDS = {
  id: true,
  userId: true,
  action: true,
  target: true,
  ip: true,
  detail: true,
  createdAt: true,
} as const;

// ADMIN 可见的完整字段
const ADMIN_FIELDS = {
  id: true,
  userId: true,
  action: true,
  target: true,
  ip: true,
  detail: true,
  prevHash: true,
  hash: true,
  seq: true,
  createdAt: true,
} as const;

// 解析分页参数：page 从 1 起，pageSize 默认 20，最大 100
function parsePagination(req: Request): { skip: number; take: number; page: number; pageSize: number } {
  const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
  const pageSizeRaw = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

// GET /api/audit  查询审计日志（仅 ADMIN / AUDITOR）
// 支持 query: userId / action / from / to / page / pageSize
// 按 seq desc 排序；ADMIN 返回完整字段，AUDITOR 不返回 hash/prevHash/seq
router.get(
  '/',
  requireRole('ADMIN', 'AUDITOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { skip, take, page, pageSize } = parsePagination(req);
      const where: Prisma.AuditLogWhereInput = {};

      if (req.query.userId) {
        const uid = parseInt(String(req.query.userId), 10);
        if (!Number.isNaN(uid)) where.userId = uid;
      }
      if (req.query.action) {
        where.action = String(req.query.action);
      }
      if (req.query.from || req.query.to) {
        const created: Prisma.DateTimeFilter = {};
        if (req.query.from) created.gte = new Date(String(req.query.from));
        if (req.query.to) created.lte = new Date(String(req.query.to));
        where.createdAt = created;
      }

      const isAdmin = req.user?.role === 'ADMIN';
      const select = isAdmin ? ADMIN_FIELDS : AUDITOR_FIELDS;

      const [total, items] = await Promise.all([
        auditRepo.count({ where }),
        auditRepo.findMany({
          where,
          orderBy: { seq: 'desc' },
          skip,
          take,
          select,
        }),
      ]);

      return res.json({
        items,
        total,
        page,
        pageSize,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/audit/verify  校验审计链完整性（仅 ADMIN）
// 返回 { valid, brokenAt?, total }
router.get(
  '/verify',
  requireRole('ADMIN'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await verifyAuditChain();
      return res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
