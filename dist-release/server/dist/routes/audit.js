"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const role_1 = require("../middlewares/role");
const auditRepo_1 = __importDefault(require("../repositories/auditRepo"));
const audit_1 = require("../middlewares/audit");
const router = (0, express_1.Router)();
// 所有审计日志接口都需要登录
router.use(auth_1.authenticate);
// AUDITOR 仅可见的字段：不含 hash / prevHash / seq
const AUDITOR_FIELDS = {
    id: true,
    userId: true,
    action: true,
    target: true,
    ip: true,
    detail: true,
    createdAt: true,
};
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
};
// 解析分页参数：page 从 1 起，pageSize 默认 20，最大 100
function parsePagination(req) {
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}
// GET /api/audit  查询审计日志（仅 ADMIN / AUDITOR）
// 支持 query: userId / action / from / to / page / pageSize
// 按 seq desc 排序；ADMIN 返回完整字段，AUDITOR 不返回 hash/prevHash/seq
router.get('/', (0, role_1.requireRole)('ADMIN', 'AUDITOR'), async (req, res, next) => {
    try {
        const { skip, take, page, pageSize } = parsePagination(req);
        const where = {};
        if (req.query.userId) {
            const uid = parseInt(String(req.query.userId), 10);
            if (!Number.isNaN(uid))
                where.userId = uid;
        }
        if (req.query.action) {
            where.action = String(req.query.action);
        }
        if (req.query.from || req.query.to) {
            const created = {};
            if (req.query.from)
                created.gte = new Date(String(req.query.from));
            if (req.query.to)
                created.lte = new Date(String(req.query.to));
            where.createdAt = created;
        }
        const isAdmin = req.user?.role === 'ADMIN';
        const select = isAdmin ? ADMIN_FIELDS : AUDITOR_FIELDS;
        const [total, items] = await Promise.all([
            auditRepo_1.default.count({ where }),
            auditRepo_1.default.findMany({
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
    }
    catch (err) {
        next(err);
    }
});
// GET /api/audit/verify  校验审计链完整性（仅 ADMIN）
// 返回 { valid, brokenAt?, total }
router.get('/verify', (0, role_1.requireRole)('ADMIN'), async (_req, res, next) => {
    try {
        const result = await (0, audit_1.verifyAuditChain)();
        return res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
