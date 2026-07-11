"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_LABEL = exports.TAX_TYPE_LABEL = void 0;
exports.generate = generate;
exports.list = list;
exports.detail = detail;
exports.updateStatus = updateStatus;
exports.vatPayable = vatPayable;
exports.exportExcel = exportExcel;
const zod_1 = require("zod");
const XLSX = __importStar(require("xlsx"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const taxReturnService_1 = require("../services/taxReturnService");
// ============ 常量与校验 schema ============
// 税种取值
const TAX_TYPES = ['VAT', 'CIT', 'SURTAX', 'IIT', 'STAMP'];
// 申报状态取值
const STATUSES = ['DRAFT', 'PENDING', 'FILED', 'PAID'];
// 状态流转顺序：DRAFT → PENDING → FILED → PAID
const STATUS_FLOW = {
    DRAFT: 'PENDING',
    PENDING: 'FILED',
    FILED: 'PAID',
};
// 税种中文映射
exports.TAX_TYPE_LABEL = {
    VAT: '增值税',
    CIT: '企业所得税',
    SURTAX: '附加税',
    IIT: '个人所得税',
    STAMP: '印花税',
};
// 状态中文映射
exports.STATUS_LABEL = {
    DRAFT: '草稿',
    PENDING: '待申报',
    FILED: '已申报',
    PAID: '已缴款',
};
// 生成申报表校验
const generateSchema = zod_1.z.object({
    subjectId: zod_1.z.number().int().positive('主体ID无效'),
    taxType: zod_1.z.enum(TAX_TYPES),
    period: zod_1.z
        .string()
        .min(1, '所属期不能为空')
        .regex(/^\d{4}(-\d{1,2}|-Q[1-4]|-FY)?$/, '所属期格式应为 YYYY-MM / YYYY-Q1..Q4 / YYYY-FY'),
    isAnnual: zod_1.z.boolean().optional(),
    urbanRate: zod_1.z.number().optional(),
});
// 更新状态校验
const updateStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(STATUSES),
    paymentVoucher: zod_1.z.string().max(100).optional().nullable(),
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
// 根据税种调用对应生成函数
async function generateReport(taxType, subjectId, period, isAnnual, urbanRate) {
    switch (taxType) {
        case 'VAT': {
            const report = await (0, taxReturnService_1.generateVATReturn)(subjectId, period);
            return { report, taxAmount: report.summary.taxAmount };
        }
        case 'CIT': {
            const report = await (0, taxReturnService_1.generateCITReturn)(subjectId, period, isAnnual ?? false);
            return { report, taxAmount: report.summary.taxAmount };
        }
        case 'SURTAX': {
            const report = await (0, taxReturnService_1.generateSurTaxReturn)(subjectId, period, urbanRate ?? 0.07);
            return { report, taxAmount: report.summary.taxAmount };
        }
        case 'IIT': {
            const report = await (0, taxReturnService_1.generateIITReturn)(subjectId, period);
            return { report, taxAmount: report.summary.taxAmount };
        }
        case 'STAMP': {
            const report = await (0, taxReturnService_1.generateStampTaxReturn)(subjectId, period);
            return { report, taxAmount: report.summary.taxAmount };
        }
        default:
            throw new Error(`不支持的税种: ${taxType}`);
    }
}
// 序列化 TaxReturn 记录：Decimal 无需处理，reportData 解析可选
function serializeTaxReturn(record) {
    return {
        id: record.id,
        subjectId: record.subjectId,
        taxType: record.taxType,
        taxTypeLabel: exports.TAX_TYPE_LABEL[record.taxType] ?? record.taxType,
        period: record.period,
        status: record.status,
        statusLabel: exports.STATUS_LABEL[record.status] ?? record.status,
        filedAt: record.filedAt,
        filedBy: record.filedBy,
        paidAt: record.paidAt,
        paidBy: record.paidBy,
        paymentVoucher: record.paymentVoucher,
        createdBy: record.createdBy,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        subject: record.subject
            ? {
                id: record.subject.id,
                name: record.subject.name,
                taxNumber: record.subject.taxNumber,
                taxpayerType: record.subject.taxpayerType,
            }
            : undefined,
    };
}
// ============ 控制器方法 ============
// POST /api/tax-returns/generate  生成申报表（ADMIN/ACCOUNTANT）
// 调用对应 generate 函数，创建/更新 TaxReturn（status=DRAFT），返回 reportData
async function generate(req, res, next) {
    try {
        const parsed = generateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { subjectId, taxType, period, isAnnual, urbanRate } = parsed.data;
        const userId = req.user.id;
        // 校验主体存在
        const subject = await prisma_1.default.taxpayerSubject.findUnique({ where: { id: subjectId } });
        if (!subject) {
            return res.status(400).json({ error: '纳税人主体不存在' });
        }
        // 生成申报表
        const { report, taxAmount } = await generateReport(taxType, subjectId, period, isAnnual, urbanRate);
        const reportData = JSON.stringify(report);
        // 创建或更新 TaxReturn（按 subjectId+taxType+period 唯一）
        const taxReturn = await prisma_1.default.taxReturn.upsert({
            where: {
                subjectId_taxType_period: { subjectId, taxType, period },
            },
            create: {
                subjectId,
                taxType,
                period,
                reportData,
                status: 'DRAFT',
                createdBy: userId,
            },
            update: {
                reportData,
                // 已存在且非草稿状态时不重置状态，仅刷新数据；草稿/待申报可重新生成
                ...(await shouldResetStatus(subjectId, taxType, period) ? { status: 'DRAFT' } : {}),
            },
            include: {
                subject: { select: { id: true, name: true, taxNumber: true, taxpayerType: true } },
            },
        });
        const serialized = serializeTaxReturn(taxReturn);
        return res.status(201).json({
            ...serialized,
            reportData: report,
            taxAmount,
        });
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// 判断重新生成时是否重置状态为草稿：仅 DRAFT/PENDING 可重置，FILED/PAID 保留状态
async function shouldResetStatus(subjectId, taxType, period) {
    const existing = await prisma_1.default.taxReturn.findUnique({
        where: { subjectId_taxType_period: { subjectId, taxType, period } },
        select: { status: true },
    });
    if (!existing)
        return true;
    return existing.status === 'DRAFT' || existing.status === 'PENDING';
}
// GET /api/tax-returns  列表（分页），按 subjectId / taxType / status / period 过滤
async function list(req, res, next) {
    try {
        const { skip, take, page, pageSize } = parsePagination(req);
        const where = {};
        if (req.query.subjectId) {
            const sid = parseInt(String(req.query.subjectId), 10);
            if (!Number.isNaN(sid))
                where.subjectId = sid;
        }
        if (req.query.taxType && TAX_TYPES.includes(req.query.taxType)) {
            where.taxType = String(req.query.taxType);
        }
        if (req.query.status && STATUSES.includes(req.query.status)) {
            where.status = String(req.query.status);
        }
        if (req.query.period) {
            where.period = String(req.query.period);
        }
        const [total, records] = await Promise.all([
            prisma_1.default.taxReturn.count({ where }),
            prisma_1.default.taxReturn.findMany({
                where,
                orderBy: [{ period: 'desc' }, { id: 'desc' }],
                skip,
                take,
                include: {
                    subject: { select: { id: true, name: true, taxNumber: true, taxpayerType: true } },
                },
            }),
        ]);
        // 解析 reportData 提取应纳税额汇总
        const items = records.map((r) => {
            const serialized = serializeTaxReturn(r);
            let taxAmount = 0;
            let summary;
            try {
                const data = JSON.parse(r.reportData);
                summary = data.summary;
                if (summary && typeof summary.taxAmount === 'number') {
                    taxAmount = summary.taxAmount;
                }
            }
            catch {
                // ignore parse error
            }
            return { ...serialized, taxAmount, summary };
        });
        return res.json({ items, total, page, pageSize });
    }
    catch (err) {
        next(err);
    }
}
// GET /api/tax-returns/:id  详情（含 reportData 解析）
async function detail(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的申报 ID' });
        }
        const record = await prisma_1.default.taxReturn.findUnique({
            where: { id },
            include: {
                subject: { select: { id: true, name: true, taxNumber: true, taxpayerType: true } },
            },
        });
        if (!record) {
            return res.status(404).json({ error: '税务申报记录不存在' });
        }
        const serialized = serializeTaxReturn(record);
        let reportData = null;
        let taxAmount = 0;
        try {
            reportData = JSON.parse(record.reportData);
            const summary = reportData.summary;
            if (summary && typeof summary.taxAmount === 'number') {
                taxAmount = summary.taxAmount;
            }
        }
        catch {
            // ignore parse error
        }
        return res.json({ ...serialized, reportData, taxAmount });
    }
    catch (err) {
        next(err);
    }
}
// PUT /api/tax-returns/:id/status  更新状态（ADMIN/ACCOUNTANT）
// 状态流转：DRAFT→PENDING→FILED→PAID，校验顺序
// FILED 记 filedAt/filedBy，PAID 记 paidAt/paidBy
async function updateStatus(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的申报 ID' });
        }
        const parsed = updateStatusSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
        }
        const { status: targetStatus, paymentVoucher } = parsed.data;
        const userId = req.user.id;
        const existing = await prisma_1.default.taxReturn.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: '税务申报记录不存在' });
        }
        // 校验状态流转顺序：目标状态必须是当前状态的下一合法状态
        const nextStatus = STATUS_FLOW[existing.status];
        if (!nextStatus || nextStatus !== targetStatus) {
            return res.status(400).json({
                error: `状态流转非法：当前 ${exports.STATUS_LABEL[existing.status]} 仅可变更为 ${nextStatus ? exports.STATUS_LABEL[nextStatus] : '终态'}`,
            });
        }
        // 构造更新数据
        const updateData = { status: targetStatus };
        if (targetStatus === 'FILED') {
            updateData.filedAt = new Date();
            updateData.filedBy = userId;
        }
        else if (targetStatus === 'PAID') {
            updateData.paidAt = new Date();
            updateData.paidBy = userId;
            if (paymentVoucher) {
                updateData.paymentVoucher = paymentVoucher;
            }
        }
        const updated = await prisma_1.default.taxReturn.update({
            where: { id },
            data: updateData,
            include: {
                subject: { select: { id: true, name: true, taxNumber: true, taxpayerType: true } },
            },
        });
        const serialized = serializeTaxReturn(updated);
        let reportData = null;
        try {
            reportData = JSON.parse(updated.reportData);
        }
        catch {
            // ignore
        }
        return res.json({ ...serialized, reportData });
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// GET /api/tax-returns/vat-payable  查询某主体某期间应纳增值税额（附加税基础预览）
async function vatPayable(req, res, next) {
    try {
        const subjectId = parseInt(String(req.query.subjectId), 10);
        const period = req.query.period ? String(req.query.period) : '';
        if (Number.isNaN(subjectId) || !period) {
            return res.status(400).json({ error: '请提供 subjectId 与 period 参数' });
        }
        const payable = await (0, taxReturnService_1.getVATPayable)(subjectId, period);
        return res.json({ subjectId, period, vatPayable: payable });
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
// GET /api/tax-returns/:id/export  导出申报表为 Excel
// 使用 xlsx 生成，按 reportData 结构展开为多 sheet
async function exportExcel(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: '无效的申报 ID' });
        }
        const record = await prisma_1.default.taxReturn.findUnique({
            where: { id },
            include: {
                subject: { select: { id: true, name: true, taxNumber: true, taxpayerType: true } },
            },
        });
        if (!record) {
            return res.status(404).json({ error: '税务申报记录不存在' });
        }
        let report = {};
        try {
            report = JSON.parse(record.reportData);
        }
        catch {
            report = { error: '申报数据解析失败', raw: record.reportData };
        }
        // 构建 Excel 工作簿：基本信息 sheet + 各结构化数据 sheet
        const wb = XLSX.utils.book_new();
        // 基本信息
        const baseInfo = [
            { 项目: '纳税人名称', 内容: record.subject?.name ?? '' },
            { 项目: '纳税人识别号', 内容: record.subject?.taxNumber ?? '' },
            { 项目: '税种', 内容: exports.TAX_TYPE_LABEL[record.taxType] ?? record.taxType },
            { 项目: '税款所属期', 内容: record.period },
            { 项目: '申报状态', 内容: exports.STATUS_LABEL[record.status] ?? record.status },
            {
                项目: '申报时间',
                内容: record.filedAt ? new Date(record.filedAt).toLocaleString('zh-CN') : '',
            },
            { 项目: '缴款凭证号', 内容: record.paymentVoucher ?? '' },
        ];
        const wsBase = XLSX.utils.json_to_sheet(baseInfo);
        XLSX.utils.book_append_sheet(wb, wsBase, '基本信息');
        // 将 reportData 中的数组/对象展开为各 sheet
        for (const [key, value] of Object.entries(report)) {
            const sheetName = key.slice(0, 28); // Excel sheet 名长度限制
            if (Array.isArray(value) && value.length > 0) {
                const ws = XLSX.utils.json_to_sheet(value);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }
            else if (value && typeof value === 'object' && !Array.isArray(value)) {
                // 对象展开为键值对
                const rows = Object.entries(value).map(([k, v]) => ({
                    项目: k,
                    内容: typeof v === 'object' ? JSON.stringify(v) : String(v),
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }
        }
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const filename = encodeURIComponent(`${exports.TAX_TYPE_LABEL[record.taxType] ?? record.taxType}_申报_${record.period}.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (err) {
        return handleServiceError(res, err) || next(err);
    }
}
