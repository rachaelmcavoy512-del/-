"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.quickCreate = quickCreate;
exports.summary = summary;
exports.createTaxpayer = createTaxpayer;
exports.listTaxpayers = listTaxpayers;
exports.getTaxpayer = getTaxpayer;
exports.updateTaxpayer = updateTaxpayer;
exports.deleteTaxpayer = deleteTaxpayer;
exports.listAccounts = listAccounts;
exports.createAccount = createAccount;
exports.updateAccount = updateAccount;
exports.deleteAccount = deleteAccount;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../utils/prisma"));
const accounts_1 = require("../seed/accounts");
// ============ 校验 schema ============
// 纳税人类型取值
const TAXPAYER_TYPES = ['SMALL_SCALE', 'GENERAL'];
// 科目方向
const DIRECTIONS = ['DEBIT', 'CREDIT'];
// 科目类别
const CATEGORIES = ['ASSET', 'LIABILITY', 'EQUITY', 'COST', 'INCOME', 'EXPENSE'];
// 创建纳税人主体校验
const createSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, '企业名称不能为空'),
    taxNumber: zod_1.z.string().min(1, '纳税人识别号不能为空'),
    taxpayerType: zod_1.z.enum(TAXPAYER_TYPES),
    industry: zod_1.z.string().optional(),
    taxRate: zod_1.z.number().min(0).max(1).optional(),
    address: zod_1.z.string().optional(),
    phone: zod_1.z.string().optional(),
    legalPerson: zod_1.z.string().optional(),
});
// 更新纳税人主体校验
const updateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    taxpayerType: zod_1.z.enum(TAXPAYER_TYPES).optional(),
    industry: zod_1.z.string().optional().nullable(),
    taxRate: zod_1.z.number().min(0).max(1).optional().nullable(),
    address: zod_1.z.string().optional().nullable(),
    phone: zod_1.z.string().optional().nullable(),
    legalPerson: zod_1.z.string().optional().nullable(),
});
// 科目校验
const accountSchema = zod_1.z.object({
    code: zod_1.z.string().min(1, '科目编码不能为空'),
    name: zod_1.z.string().min(1, '科目名称不能为空'),
    direction: zod_1.z.enum(DIRECTIONS),
    level: zod_1.z.number().int().min(1).max(4),
    parentCode: zod_1.z.string().optional().nullable(),
    category: zod_1.z.enum(CATEGORIES),
    balanceDirection: zod_1.z.enum(DIRECTIONS),
    isLeaf: zod_1.z.boolean().optional(),
});
// ============ 序列化辅助 ============
// 将 Prisma Decimal 类型的 taxRate 转为 number，便于 JSON 响应
function serializeTaxRate(taxRate) {
    if (taxRate === null || taxRate === undefined)
        return null;
    const num = Number(taxRate.toString());
    return Number.isNaN(num) ? null : num;
}
// 根据纳税人类型获取初始化科目体系
function getSeedAccounts(taxpayerType) {
    return taxpayerType === 'GENERAL' ? accounts_1.GENERAL_TAXPAYER_ACCOUNTS : accounts_1.SMALL_SCALE_ACCOUNTS;
}
// ============ 控制器方法 ============
// POST /api/taxpayers/quick-create  极简创建（仅 ADMIN）
// 新手友好：仅需 name+taxNumber+taxpayerType，复用 createTaxpayer 的科目初始化逻辑
async function quickCreate(req, res, next) {
    try {
        const quickSchema = zod_1.z.object({
            name: zod_1.z.string().min(1, '企业名称不能为空'),
            taxNumber: zod_1.z.string().min(1, '纳税人识别号不能为空'),
            taxpayerType: zod_1.z.enum(TAXPAYER_TYPES),
        });
        const parsed = quickSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { name, taxNumber, taxpayerType } = parsed.data;
        // 纳税人识别号唯一性校验
        const existing = await prisma_1.default.taxpayerSubject.findUnique({ where: { taxNumber } });
        if (existing) {
            return res.status(400).json({ error: '纳税人识别号已存在' });
        }
        // 事务：创建主体 + 初始化科目体系
        const taxpayer = await prisma_1.default.$transaction(async (tx) => {
            const subject = await tx.taxpayerSubject.create({
                data: { name, taxNumber, taxpayerType },
            });
            const seedAccounts = getSeedAccounts(taxpayerType);
            await tx.account.createMany({
                data: seedAccounts.map((a) => ({
                    subjectId: subject.id,
                    code: a.code,
                    name: a.name,
                    direction: a.direction,
                    level: a.level,
                    parentCode: a.parentCode ?? null,
                    category: a.category,
                    balanceDirection: a.balanceDirection,
                    isLeaf: a.isLeaf,
                })),
            });
            return subject;
        });
        const accountCount = await prisma_1.default.account.count({ where: { subjectId: taxpayer.id } });
        return res.status(201).json({
            ...taxpayer,
            taxRate: serializeTaxRate(taxpayer.taxRate),
            accountCount,
        });
    }
    catch (err) {
        next(err);
    }
}
// GET /api/taxpayers/summary  首页统计（所有登录用户）
// 返回所有主体列表，每个附 riskCount(当月PENDING/IN_PROGRESS)、voucherCount(当月凭证数)、lastReportPeriod
async function summary(_req, res, next) {
    try {
        const subjects = await prisma_1.default.taxpayerSubject.findMany({
            orderBy: { createdAt: 'desc' },
        });
        // 当月期次
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const period = `${year}-${String(month).padStart(2, '0')}`;
        const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
        const result = [];
        for (const t of subjects) {
            // 当月风险数：PENDING/IN_PROGRESS
            const riskCount = await prisma_1.default.riskEvent.count({
                where: {
                    subjectId: t.id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
            });
            // 当月凭证数
            const voucherCount = await prisma_1.default.voucher.count({
                where: {
                    subjectId: t.id,
                    voucherDate: { gte: monthStart, lte: monthEnd },
                },
            });
            // 最近申报期次
            const latestReturn = await prisma_1.default.taxReturn.findFirst({
                where: { subjectId: t.id },
                orderBy: { period: 'desc' },
                select: { period: true },
            });
            result.push({
                id: t.id,
                name: t.name,
                taxNumber: t.taxNumber,
                taxpayerType: t.taxpayerType,
                riskCount,
                voucherCount,
                lastReportPeriod: latestReturn?.period ?? null,
            });
        }
        return res.json(result);
    }
    catch (err) {
        next(err);
    }
}
// POST /api/taxpayers  创建纳税人主体（仅 ADMIN）
// 创建后根据 taxpayerType 自动初始化对应科目体系，事务保证一致性
async function createTaxpayer(req, res, next) {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { name, taxNumber, taxpayerType, industry, taxRate, address, phone, legalPerson } = parsed.data;
        // 纳税人识别号唯一性校验
        const existing = await prisma_1.default.taxpayerSubject.findUnique({ where: { taxNumber } });
        if (existing) {
            return res.status(400).json({ error: '纳税人识别号已存在' });
        }
        // 事务：创建主体 + 初始化科目体系
        const taxpayer = await prisma_1.default.$transaction(async (tx) => {
            const subject = await tx.taxpayerSubject.create({
                data: {
                    name,
                    taxNumber,
                    taxpayerType,
                    industry: industry ?? null,
                    taxRate: taxRate !== undefined ? taxRate : null,
                    address: address ?? null,
                    phone: phone ?? null,
                    legalPerson: legalPerson ?? null,
                },
            });
            const seedAccounts = getSeedAccounts(taxpayerType);
            await tx.account.createMany({
                data: seedAccounts.map((a) => ({
                    subjectId: subject.id,
                    code: a.code,
                    name: a.name,
                    direction: a.direction,
                    level: a.level,
                    parentCode: a.parentCode ?? null,
                    category: a.category,
                    balanceDirection: a.balanceDirection,
                    isLeaf: a.isLeaf,
                })),
            });
            return subject;
        });
        // 返回时带科目数量
        const accountCount = await prisma_1.default.account.count({ where: { subjectId: taxpayer.id } });
        return res.status(201).json({
            ...taxpayer,
            taxRate: serializeTaxRate(taxpayer.taxRate),
            accountCount,
        });
    }
    catch (err) {
        next(err);
    }
}
// GET /api/taxpayers  列表查询（所有登录用户可查）
// 支持 query ?type=&keyword=（按名称或税号模糊）
async function listTaxpayers(req, res, next) {
    try {
        const { type, keyword } = req.query;
        // 构建查询条件
        const where = {};
        if (type && TAXPAYER_TYPES.includes(type)) {
            where.taxpayerType = type;
        }
        if (keyword && keyword.trim()) {
            where.OR = [
                { name: { contains: keyword } },
                { taxNumber: { contains: keyword } },
            ];
        }
        const list = await prisma_1.default.taxpayerSubject.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
        const result = list.map((t) => ({
            ...t,
            taxRate: serializeTaxRate(t.taxRate),
        }));
        return res.json(result);
    }
    catch (err) {
        next(err);
    }
}
// GET /api/taxpayers/:id  详情（含 accounts 科目列表）
async function getTaxpayer(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的主体 ID' });
        }
        const taxpayer = await prisma_1.default.taxpayerSubject.findUnique({
            where: { id },
            include: { accounts: { orderBy: { code: 'asc' } } },
        });
        if (!taxpayer) {
            return res.status(404).json({ error: '纳税人主体不存在' });
        }
        return res.json({
            ...taxpayer,
            taxRate: serializeTaxRate(taxpayer.taxRate),
            accounts: taxpayer.accounts,
        });
    }
    catch (err) {
        next(err);
    }
}
// PUT /api/taxpayers/:id  更新主体基础信息（仅 ADMIN）
// taxpayerType 一旦存在科目则不允许修改
async function updateTaxpayer(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的主体 ID' });
        }
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const data = parsed.data;
        const existing = await prisma_1.default.taxpayerSubject.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: '纳税人主体不存在' });
        }
        // taxpayerType 修改限制：存在科目时禁止修改
        if (data.taxpayerType && data.taxpayerType !== existing.taxpayerType) {
            const accountCount = await prisma_1.default.account.count({ where: { subjectId: id } });
            if (accountCount > 0) {
                return res.status(400).json({ error: '该主体已初始化科目体系，不允许修改纳税人类型' });
            }
        }
        // 税号唯一性校验（如修改税号）
        if (req.body.taxNumber !== undefined && req.body.taxNumber !== existing.taxNumber) {
            const dup = await prisma_1.default.taxpayerSubject.findUnique({ where: { taxNumber: req.body.taxNumber } });
            if (dup) {
                return res.status(400).json({ error: '纳税人识别号已存在' });
            }
        }
        // 构造更新数据，排除 undefined 字段
        const updateData = {};
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.taxpayerType !== undefined)
            updateData.taxpayerType = data.taxpayerType;
        if (data.industry !== undefined)
            updateData.industry = data.industry;
        if (data.address !== undefined)
            updateData.address = data.address;
        if (data.phone !== undefined)
            updateData.phone = data.phone;
        if (data.legalPerson !== undefined)
            updateData.legalPerson = data.legalPerson;
        if (data.taxRate !== undefined)
            updateData.taxRate = data.taxRate;
        // 税号单独处理（不在 updateSchema 中，但允许修改）
        if (req.body.taxNumber !== undefined)
            updateData.taxNumber = req.body.taxNumber;
        const updated = await prisma_1.default.taxpayerSubject.update({
            where: { id },
            data: updateData,
        });
        return res.json({
            ...updated,
            taxRate: serializeTaxRate(updated.taxRate),
        });
    }
    catch (err) {
        next(err);
    }
}
// DELETE /api/taxpayers/:id  删除主体（仅 ADMIN），级联删除科目
async function deleteTaxpayer(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的主体 ID' });
        }
        const existing = await prisma_1.default.taxpayerSubject.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: '纳税人主体不存在' });
        }
        // schema 已配置 onDelete: Cascade，删除主体会自动级联删除科目
        await prisma_1.default.taxpayerSubject.delete({ where: { id } });
        return res.json({ message: '删除成功' });
    }
    catch (err) {
        next(err);
    }
}
// GET /api/taxpayers/:id/accounts  获取某主体科目列表
// 按 code 排序，可 query ?category=&level=
async function listAccounts(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的主体 ID' });
        }
        const { category, level } = req.query;
        const existing = await prisma_1.default.taxpayerSubject.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: '纳税人主体不存在' });
        }
        const where = { subjectId: id };
        if (category && CATEGORIES.includes(category)) {
            where.category = category;
        }
        if (level !== undefined && level !== '') {
            const lv = Number(level);
            if (!Number.isNaN(lv)) {
                where.level = lv;
            }
        }
        const accounts = await prisma_1.default.account.findMany({
            where,
            orderBy: { code: 'asc' },
        });
        return res.json(accounts);
    }
    catch (err) {
        next(err);
    }
}
// POST /api/taxpayers/:id/accounts  新增自定义科目（ADMIN/ACCOUNTANT）
async function createAccount(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的主体 ID' });
        }
        const parsed = accountSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { code, name, direction, level, parentCode, category, balanceDirection, isLeaf } = parsed.data;
        const existing = await prisma_1.default.taxpayerSubject.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: '纳税人主体不存在' });
        }
        // 科目编码在同主体内唯一
        const dup = await prisma_1.default.account.findUnique({
            where: { subjectId_code: { subjectId: id, code } },
        });
        if (dup) {
            return res.status(400).json({ error: '该科目编码已存在' });
        }
        const account = await prisma_1.default.account.create({
            data: {
                subjectId: id,
                code,
                name,
                direction,
                level,
                parentCode: parentCode ?? null,
                category,
                balanceDirection,
                isLeaf: isLeaf ?? true,
            },
        });
        return res.status(201).json(account);
    }
    catch (err) {
        next(err);
    }
}
// PUT /api/taxpayers/:id/accounts/:accountId  修改科目
async function updateAccount(req, res, next) {
    try {
        const subjectId = Number(req.params.id);
        const accountId = Number(req.params.accountId);
        if (Number.isNaN(subjectId) || Number.isNaN(accountId)) {
            return res.status(400).json({ error: '无效的 ID' });
        }
        const parsed = accountSchema.partial().safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const data = parsed.data;
        const existing = await prisma_1.default.account.findUnique({ where: { id: accountId } });
        if (!existing || existing.subjectId !== subjectId) {
            return res.status(404).json({ error: '科目不存在' });
        }
        // 若修改 code，校验唯一性
        if (data.code && data.code !== existing.code) {
            const dup = await prisma_1.default.account.findUnique({
                where: { subjectId_code: { subjectId, code: data.code } },
            });
            if (dup) {
                return res.status(400).json({ error: '该科目编码已存在' });
            }
        }
        const updateData = {};
        if (data.code !== undefined)
            updateData.code = data.code;
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.direction !== undefined)
            updateData.direction = data.direction;
        if (data.level !== undefined)
            updateData.level = data.level;
        if (data.parentCode !== undefined)
            updateData.parentCode = data.parentCode ?? null;
        if (data.category !== undefined)
            updateData.category = data.category;
        if (data.balanceDirection !== undefined)
            updateData.balanceDirection = data.balanceDirection;
        if (data.isLeaf !== undefined)
            updateData.isLeaf = data.isLeaf;
        const updated = await prisma_1.default.account.update({
            where: { id: accountId },
            data: updateData,
        });
        return res.json(updated);
    }
    catch (err) {
        next(err);
    }
}
// DELETE /api/taxpayers/:id/accounts/:accountId  删除科目
// 简单实现：直接删除（后续 Task3 接入余额与凭证引用校验）
async function deleteAccount(req, res, next) {
    try {
        const subjectId = Number(req.params.id);
        const accountId = Number(req.params.accountId);
        if (Number.isNaN(subjectId) || Number.isNaN(accountId)) {
            return res.status(400).json({ error: '无效的 ID' });
        }
        const existing = await prisma_1.default.account.findUnique({ where: { id: accountId } });
        if (!existing || existing.subjectId !== subjectId) {
            return res.status(404).json({ error: '科目不存在' });
        }
        await prisma_1.default.account.delete({ where: { id: accountId } });
        return res.json({ message: '删除成功' });
    }
    catch (err) {
        next(err);
    }
}
