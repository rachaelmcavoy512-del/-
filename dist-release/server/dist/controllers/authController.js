"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.login = login;
exports.me = me;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../utils/prisma"));
const auth_1 = require("../middlewares/auth");
// 注册参数校验
const registerSchema = zod_1.z.object({
    username: zod_1.z.string().min(1, '用户名不能为空'),
    password: zod_1.z.string().min(6, '密码至少 6 位'),
    role: zod_1.z.enum(['ADMIN', 'ACCOUNTANT', 'AUDITOR', 'VIEWER']).optional(),
});
// 登录参数校验
const loginSchema = zod_1.z.object({
    username: zod_1.z.string().min(1),
    password: zod_1.z.string().min(1),
});
// POST /api/auth/register
// 仅 ADMIN 可调用；当 BOOTSTRAP_ADMIN=true 且系统中尚无用户时，允许首次注册（首个用户强制为 ADMIN）
async function register(req, res, next) {
    try {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { username, password, role } = parsed.data;
        const userCount = await prisma_1.default.user.count();
        const bootstrapOpen = process.env.BOOTSTRAP_ADMIN === 'true';
        // 非首次注册场景，必须由管理员调用
        if (userCount > 0 || !bootstrapOpen) {
            if (!req.user || req.user.role !== 'ADMIN') {
                return res.status(403).json({ error: '无权限' });
            }
        }
        // 用户名唯一性校验
        const existing = await prisma_1.default.user.findUnique({ where: { username } });
        if (existing) {
            return res.status(400).json({ error: '用户名已存在' });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        // 首个用户强制为 ADMIN，其余按传入角色（默认 VIEWER）
        const assignedRole = userCount === 0 ? 'ADMIN' : role ?? 'VIEWER';
        const user = await prisma_1.default.user.create({
            data: { username, passwordHash, role: assignedRole },
        });
        return res.status(201).json({
            id: user.id,
            username: user.username,
            role: user.role,
        });
    }
    catch (err) {
        next(err);
    }
}
// POST /api/auth/login
// 校验用户名密码，返回 JWT token（有效期 7 天）
async function login(req, res, next) {
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { username, password } = parsed.data;
        const user = await prisma_1.default.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        const ok = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!ok) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        const token = (0, auth_1.signToken)(user.id, user.role);
        return res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            },
        });
    }
    catch (err) {
        next(err);
    }
}
// GET /api/auth/me
// 返回当前登录用户信息
async function me(req, res, next) {
    try {
        if (!req.user) {
            return res.status(401).json({ error: '未登录' });
        }
        const user = await prisma_1.default.user.findUnique({ where: { id: req.user.id } });
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        return res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        });
    }
    catch (err) {
        next(err);
    }
}
