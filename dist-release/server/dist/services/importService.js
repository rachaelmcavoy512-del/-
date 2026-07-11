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
exports.BATCH_STATUS = exports.DATA_TYPES = exports.BANK_DIRECTIONS = exports.INVOICE_STATUS = exports.INVOICE_DIRECTIONS = exports.INVOICE_TYPES = void 0;
exports.generateBatchNo = generateBatchNo;
exports.importInvoices = importInvoices;
exports.importBankTransactions = importBankTransactions;
exports.importPayrolls = importPayrolls;
exports.persistImport = persistImport;
exports.serializeInvoice = serializeInvoice;
exports.serializeBankTransaction = serializeBankTransaction;
exports.serializePayroll = serializePayroll;
exports.serializeBatch = serializeBatch;
const xlsx = __importStar(require("xlsx"));
const xml2js_1 = require("xml2js");
const prisma_1 = __importDefault(require("../utils/prisma"));
const riskScanService_1 = require("./riskScanService");
// ============ 常量定义 ============
// 发票类型取值
exports.INVOICE_TYPES = ['SPECIAL', 'NORMAL', 'ELECTRONIC', 'OTHER'];
// 发票方向（进项/销项）
exports.INVOICE_DIRECTIONS = ['INPUT', 'OUTPUT'];
// 发票状态
exports.INVOICE_STATUS = ['NORMAL', 'VOID', 'RED'];
// 银行流水方向（收入/支出）
exports.BANK_DIRECTIONS = ['IN', 'OUT'];
// 导入数据类型
exports.DATA_TYPES = ['INVOICE', 'BANK', 'PAYROLL'];
// 批次状态
exports.BATCH_STATUS = ['PROCESSING', 'DONE', 'FAILED'];
// ============ 通用工具函数 ============
// 生成导入批次号：时间戳 + 随机后缀
function generateBatchNo() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `IMP-${ts}-${rand}`;
}
// 将单元格值转为字符串（去除首尾空白），空值返回空串
function cellStr(v) {
    if (v === null || v === undefined)
        return '';
    if (typeof v === 'string')
        return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    return String(v).trim();
}
// 将单元格值转为数字；空/非法返回 NaN
function cellNum(v) {
    if (v === null || v === undefined || v === '')
        return NaN;
    if (typeof v === 'number')
        return v;
    const s = String(v).trim().replace(/[,\s]/g, '');
    if (s === '')
        return NaN;
    const n = Number(s);
    return Number.isNaN(n) ? NaN : n;
}
// 解析日期：支持 Date 对象、Excel 序列号、字符串（YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD）
function parseDate(v) {
    if (v === null || v === undefined || v === '')
        return null;
    if (v instanceof Date) {
        return Number.isNaN(v.getTime()) ? null : v;
    }
    if (typeof v === 'number') {
        // Excel 序列号（1900 日期系统）
        if (v > 25569 && v < 60000) {
            const ms = Math.round((v - 25569) * 86400 * 1000);
            const d = new Date(ms);
            return Number.isNaN(d.getTime()) ? null : d;
        }
    }
    const s = String(v).trim();
    if (!s)
        return null;
    // 仅 YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD
    const m1 = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m1) {
        const y = Number(m1[1]);
        const mo = Number(m1[2]);
        const d = Number(m1[3]);
        const dt = new Date(y, mo - 1, d);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const m2 = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m2) {
        const dt = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
}
// 在 Excel 行中按多个候选列名查找值（大小写、空白不敏感，包含匹配）
function pick(row, names) {
    const keys = Object.keys(row);
    for (const target of names) {
        const t = target.toLowerCase().replace(/\s+/g, '');
        for (const k of keys) {
            const kk = k.toLowerCase().replace(/\s+/g, '');
            if (kk === t)
                return row[k];
        }
    }
    // 模糊包含匹配
    for (const target of names) {
        const t = target.toLowerCase().replace(/\s+/g, '');
        for (const k of keys) {
            const kk = k.toLowerCase().replace(/\s+/g, '');
            if (kk.includes(t) || t.includes(kk))
                return row[k];
        }
    }
    return undefined;
}
// 规范化发票类型：接受中文/英文，统一为大写枚举
function normalizeInvoiceType(v) {
    const s = cellStr(v).toUpperCase();
    if (!s)
        return 'OTHER';
    if (s.includes('专') || s === 'SPECIAL' || s.includes('SPECIAL'))
        return 'SPECIAL';
    if (s.includes('电子') || s === 'ELECTRONIC' || s.includes('ELECTRONIC'))
        return 'ELECTRONIC';
    if (s.includes('普') || s === 'NORMAL' || s.includes('NORMAL'))
        return 'NORMAL';
    return 'OTHER';
}
// 规范化发票方向：进项 INPUT / 销项 OUTPUT
function normalizeInvoiceDirection(v, fallback = 'INPUT') {
    const s = cellStr(v).toUpperCase();
    if (!s)
        return fallback;
    if (s.includes('销') || s === 'OUTPUT' || s.includes('OUTPUT') || s.includes('OUT'))
        return 'OUTPUT';
    if (s.includes('进') || s === 'INPUT' || s.includes('INPUT') || s.includes('IN'))
        return 'INPUT';
    return fallback;
}
// ============ 发票解析：XML（税控盘导出格式） ============
// XML 字段别名映射：英文标准名 -> 税控盘/常见别名
const INVOICE_XML_ALIASES = {
    invoiceCode: ['invoiceCode', 'fpdm', 'Fpdm', '发票代码', 'fpDm'],
    invoiceNo: ['invoiceNo', 'fphm', 'Fphm', '发票号码', 'fpHm'],
    invoiceType: ['invoiceType', 'fplx', 'Fplx', '发票类型'],
    direction: ['direction', 'fx', 'Fx', '方向', '进销项'],
    billingDate: ['billingDate', 'kprq', 'Kprq', '开票日期'],
    buyerName: ['buyerName', 'gfmc', 'Gfmc', '购方名称', '购货方名称'],
    sellerName: ['sellerName', 'xfmc', 'Xfmc', '销方名称', '销货方名称'],
    buyerTaxNo: ['buyerTaxNo', 'gfsh', 'Gfsh', '购方税号', '购货方税号'],
    sellerTaxNo: ['sellerTaxNo', 'xfsh', 'Xfsh', '销方税号', '销货方税号'],
    amountExclTax: ['amountExclTax', 'hjje', 'Hjje', '合计金额', '不含税金额', '金额'],
    taxAmount: ['taxAmount', 'hjse', 'Hjse', '合计税额', '税额'],
    amountInclTax: ['amountInclTax', 'jshj', 'Jshj', '价税合计'],
    taxRate: ['taxRate', 'sl', 'Sl', '税率'],
    status: ['status', 'fpzt', 'Fpzt', '发票状态'],
};
// 从 XML 解析结果对象中按别名取值（区分大小写，因税控盘字段多为驼峰/小写）
function xmlPick(obj, aliases) {
    for (const a of aliases) {
        if (a in obj)
            return obj[a];
    }
    // 大小写不敏感兜底
    const lowerKeys = Object.keys(obj);
    for (const a of aliases) {
        const la = a.toLowerCase();
        for (const k of lowerKeys) {
            if (k.toLowerCase() === la)
                return obj[k];
        }
    }
    return undefined;
}
// 递归从 XML 对象中收集发票候选节点：
// - 命中 <invoice>/<Invoice>/<Fp>/<fp> 等容器
// - 或同时包含发票代码与发票号码字段
function collectInvoiceNodes(node, acc) {
    if (!node || typeof node !== 'object')
        return;
    if (Array.isArray(node)) {
        for (const item of node)
            collectInvoiceNodes(item, acc);
        return;
    }
    const obj = node;
    // 判断是否为发票候选：含 invoiceCode/fpdm 之一 且 含 invoiceNo/fphm 之一
    const hasCode = xmlPick(obj, INVOICE_XML_ALIASES.invoiceCode) !== undefined;
    const hasNo = xmlPick(obj, INVOICE_XML_ALIASES.invoiceNo) !== undefined;
    if (hasCode && hasNo) {
        acc.push(obj);
        return;
    }
    // 递归子节点
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') {
            collectInvoiceNodes(v, acc);
        }
    }
}
// 从单个 XML 节点抽取标准发票对象
function extractInvoiceFromXmlNode(node) {
    const pickVal = (aliases) => xmlPick(node, aliases);
    const invoiceCode = cellStr(pickVal(INVOICE_XML_ALIASES.invoiceCode));
    const invoiceNo = cellStr(pickVal(INVOICE_XML_ALIASES.invoiceNo));
    if (!invoiceCode || !invoiceNo)
        return null;
    const billingRaw = pickVal(INVOICE_XML_ALIASES.billingDate);
    const billingDate = parseDate(billingRaw);
    if (!billingDate)
        return null;
    const amountExclTax = cellNum(pickVal(INVOICE_XML_ALIASES.amountExclTax));
    const taxAmount = cellNum(pickVal(INVOICE_XML_ALIASES.taxAmount));
    const amountInclRaw = pickVal(INVOICE_XML_ALIASES.amountInclTax);
    const amountInclTax = cellNum(amountInclRaw);
    // 价税合计缺失时用 不含税 + 税额 兜底
    const finalAmountIncl = Number.isNaN(amountInclTax) && !Number.isNaN(amountExclTax) && !Number.isNaN(taxAmount)
        ? amountExclTax + taxAmount
        : amountInclTax;
    return {
        invoiceCode,
        invoiceNo,
        invoiceType: normalizeInvoiceType(pickVal(INVOICE_XML_ALIASES.invoiceType)),
        direction: normalizeInvoiceDirection(pickVal(INVOICE_XML_ALIASES.direction)),
        billingDate,
        buyerName: cellStr(pickVal(INVOICE_XML_ALIASES.buyerName)) || null,
        sellerName: cellStr(pickVal(INVOICE_XML_ALIASES.sellerName)) || null,
        buyerTaxNo: cellStr(pickVal(INVOICE_XML_ALIASES.buyerTaxNo)) || null,
        sellerTaxNo: cellStr(pickVal(INVOICE_XML_ALIASES.sellerTaxNo)) || null,
        amountExclTax,
        taxAmount,
        amountInclTax: finalAmountIncl,
        taxRate: cellNum(pickVal(INVOICE_XML_ALIASES.taxRate)),
        status: cellStr(pickVal(INVOICE_XML_ALIASES.status)) || 'NORMAL',
    };
}
// 尝试用 xml2js 解析为发票数组；若不是合法 XML 或无发票节点，返回 null
async function parseInvoicesFromXml(buffer) {
    let parsed;
    try {
        parsed = await (0, xml2js_1.parseStringPromise)(buffer, {
            explicitArray: false,
            trim: true,
            ignoreAttrs: true,
        });
    }
    catch {
        return null; // 非合法 XML
    }
    if (!parsed || typeof parsed !== 'object')
        return null;
    const nodes = [];
    collectInvoiceNodes(parsed, nodes);
    if (nodes.length === 0)
        return null;
    const invoices = [];
    for (const n of nodes) {
        const inv = extractInvoiceFromXmlNode(n);
        if (inv)
            invoices.push(inv);
    }
    return invoices.length > 0 ? invoices : null;
}
// ============ 发票解析：Excel ============
// 从 Excel 行解析标准发票对象
function extractInvoiceFromRow(row) {
    const invoiceCode = cellStr(pick(row, ['发票代码', 'invoiceCode', '代码']));
    const invoiceNo = cellStr(pick(row, ['发票号码', 'invoiceNo', '号码']));
    if (!invoiceCode && !invoiceNo)
        return null;
    const billingDate = parseDate(pick(row, ['开票日期', 'billingDate', '日期']));
    const amountExclTax = cellNum(pick(row, ['不含税金额', '金额', 'amountExclTax', '合计金额']));
    const taxAmount = cellNum(pick(row, ['税额', '税', 'taxAmount', '合计税额']));
    const amountInclRaw = pick(row, ['价税合计', 'amountInclTax']);
    const amountInclTax = cellNum(amountInclRaw);
    const finalAmountIncl = Number.isNaN(amountInclTax) && !Number.isNaN(amountExclTax) && !Number.isNaN(taxAmount)
        ? amountExclTax + taxAmount
        : amountInclTax;
    return {
        invoiceCode,
        invoiceNo,
        invoiceType: normalizeInvoiceType(pick(row, ['发票类型', 'invoiceType', '类型'])),
        direction: normalizeInvoiceDirection(pick(row, ['方向', '进销项', 'direction', '进项/销项'])),
        billingDate: billingDate ?? new Date(0),
        buyerName: cellStr(pick(row, ['购方名称', '购货方名称', 'buyerName'])) || null,
        sellerName: cellStr(pick(row, ['销方名称', '销货方名称', 'sellerName'])) || null,
        buyerTaxNo: cellStr(pick(row, ['购方税号', '购货方税号', 'buyerTaxNo'])) || null,
        sellerTaxNo: cellStr(pick(row, ['销方税号', '销货方税号', 'sellerTaxNo'])) || null,
        amountExclTax,
        taxAmount,
        amountInclTax: finalAmountIncl,
        taxRate: cellNum(pick(row, ['税率', 'taxRate'])),
        status: cellStr(pick(row, ['状态', 'status', '发票状态'])) || 'NORMAL',
    };
}
// 将 Excel 行集合解析为发票数组
function parseInvoicesFromSheet(rows) {
    const out = [];
    for (const row of rows) {
        const inv = extractInvoiceFromRow(row);
        if (inv)
            out.push(inv);
    }
    return out;
}
// ============ 导入主流程：发票 ============
// 校验单条发票，返回错误信息（null 表示通过）
function validateInvoice(inv) {
    if (!inv.invoiceCode)
        return '发票代码不能为空';
    if (!inv.invoiceNo)
        return '发票号码不能为空';
    if (!inv.billingDate || Number.isNaN(inv.billingDate.getTime()) || inv.billingDate.getTime() === 0) {
        return '开票日期无效';
    }
    if (Number.isNaN(inv.amountExclTax))
        return '不含税金额无效';
    if (Number.isNaN(inv.taxAmount))
        return '税额无效';
    if (Number.isNaN(inv.amountInclTax))
        return '价税合计无效';
    if (!exports.INVOICE_TYPES.includes(inv.invoiceType)) {
        return `发票类型无效: ${inv.invoiceType}`;
    }
    if (!exports.INVOICE_DIRECTIONS.includes(inv.direction)) {
        return `进销项方向无效: ${inv.direction}`;
    }
    return null;
}
// 导入发票
// 解析顺序：先尝试 XML（税控盘格式），失败则用 xlsx 解析 Excel
// 去重键 [subjectId, invoiceCode, invoiceNo]：已存在则跳过并计入 skipped
async function importInvoices(subjectId, fileBuffer, fileName, userId) {
    // 1. 解析文件为标准发票对象数组
    let rawInvoices = null;
    // 仅当文件疑似 XML（首部含 <?xml 或 < ）时才尝试 XML 解析，避免二进制 xlsx 误判
    const head = fileBuffer.slice(0, 200).toString('utf8').trimStart();
    if (head.startsWith('<')) {
        rawInvoices = await parseInvoicesFromXml(fileBuffer);
    }
    if (!rawInvoices || rawInvoices.length === 0) {
        // 用 xlsx 解析
        const wb = xlsx.read(fileBuffer, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) {
            rawInvoices = [];
        }
        else {
            const sheet = wb.Sheets[sheetName];
            const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
            rawInvoices = parseInvoicesFromSheet(rows);
        }
    }
    return persistImport({
        subjectId,
        fileName,
        userId,
        dataType: 'INVOICE',
        rawList: rawInvoices,
        validate: validateInvoice,
        // 去重键：发票代码|发票号码
        dedupKeyStr: (inv) => `${inv.invoiceCode}|${inv.invoiceNo}`,
        // 预查已存在发票：按 subjectId + invoiceCode IN (...) 查询，构建去重集合
        existingQuery: async (tx, keys) => {
            const codes = [...new Set(keys.map((k) => k.split('|')[0]))];
            const existing = await tx.invoice.findMany({
                where: { subjectId, invoiceCode: { in: codes } },
                select: { invoiceCode: true, invoiceNo: true },
            });
            return new Set(existing.map((e) => `${e.invoiceCode}|${e.invoiceNo}`));
        },
        createOne: async (tx, inv, batchNo) => {
            await tx.invoice.create({
                data: {
                    subjectId,
                    invoiceCode: inv.invoiceCode,
                    invoiceNo: inv.invoiceNo,
                    invoiceType: inv.invoiceType,
                    direction: inv.direction,
                    billingDate: inv.billingDate,
                    buyerName: inv.buyerName,
                    sellerName: inv.sellerName,
                    buyerTaxNo: inv.buyerTaxNo,
                    sellerTaxNo: inv.sellerTaxNo,
                    amountExclTax: inv.amountExclTax,
                    taxAmount: inv.taxAmount,
                    amountInclTax: inv.amountInclTax,
                    taxRate: inv.taxRate,
                    status: inv.status || 'NORMAL',
                    importBatch: batchNo,
                },
            });
        },
    });
}
// ============ 银行流水导入 ============
// 校验单条银行流水
function validateBank(t) {
    if (!t.transDate || Number.isNaN(t.transDate.getTime()))
        return '交易日期无效';
    if (Number.isNaN(t.amount))
        return '金额无效';
    if (!exports.BANK_DIRECTIONS.includes(t.direction)) {
        return `收支方向无效: ${t.direction}`;
    }
    return null;
}
// 导入银行流水
// Excel 模板列：日期 / 摘要 / 收入 / 支出 / 对方户名 / 对方账号
// 若同时存在"收入""支出"两列，按非零者确定方向；若只有"金额"列，按正负号确定方向
async function importBankTransactions(subjectId, fileBuffer, fileName, userId) {
    const wb = xlsx.read(fileBuffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const rows = sheetName
        ? xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
        : [];
    const rawList = [];
    for (const row of rows) {
        const transDate = parseDate(pick(row, ['日期', '交易日期', 'transDate', '记账日期']));
        const summary = cellStr(pick(row, ['摘要', 'summary', '备注'])) || null;
        const accountNo = cellStr(pick(row, ['银行账号', '账号', 'accountNo'])) || null;
        const counterparty = cellStr(pick(row, ['对方户名', '对方账户名', 'counterparty'])) || null;
        const counterpartyAccount = cellStr(pick(row, ['对方账号', '对方账户', 'counterpartyAccount'])) || null;
        const income = cellNum(pick(row, ['收入', '借方', 'income']));
        const expense = cellNum(pick(row, ['支出', '贷方', 'expense']));
        const singleAmount = cellNum(pick(row, ['金额', 'amount']));
        let amount;
        let direction;
        if (!Number.isNaN(income) && income !== 0 && (Number.isNaN(expense) || expense === 0)) {
            amount = income;
            direction = 'IN';
        }
        else if (!Number.isNaN(expense) && expense !== 0 && (Number.isNaN(income) || income === 0)) {
            amount = expense;
            direction = 'OUT';
        }
        else if (!Number.isNaN(singleAmount)) {
            amount = Math.abs(singleAmount);
            direction = singleAmount >= 0 ? 'IN' : 'OUT';
        }
        else {
            // 至少需要金额
            amount = NaN;
            direction = 'IN';
        }
        rawList.push({
            accountNo,
            transDate: transDate ?? new Date(0),
            amount,
            direction,
            counterparty,
            counterpartyAccount,
            summary,
        });
    }
    return persistImport({
        subjectId,
        fileName,
        userId,
        dataType: 'BANK',
        rawList,
        validate: validateBank,
        dedupKeyStr: () => null, // 银行流水无去重键，按行全部入库
        existingQuery: async () => new Set(),
        createOne: async (tx, t, batchNo) => {
            await tx.bankTransaction.create({
                data: {
                    subjectId,
                    accountNo: t.accountNo,
                    transDate: t.transDate,
                    amount: t.amount,
                    direction: t.direction,
                    counterparty: t.counterparty,
                    counterpartyAccount: t.counterpartyAccount,
                    summary: t.summary,
                    importBatch: batchNo,
                },
            });
        },
    });
}
// ============ 工资导入 ============
// 校验所属期格式：YYYY-MM 且月份 01-12 有效
function isValidPeriod(p) {
    const m = /^(\d{4})-(\d{2})$/.exec(p);
    if (!m)
        return false;
    const month = Number(m[2]);
    return month >= 1 && month <= 12;
}
// 校验单条工资记录：应发 = 社保 + 公积金 + 个税 + 实发（允许 1 分误差）
function validatePayroll(p) {
    if (!p.employeeName)
        return '员工姓名不能为空';
    if (Number.isNaN(p.grossSalary))
        return '应发工资无效';
    if (Number.isNaN(p.socialInsurance))
        return '社保无效';
    if (Number.isNaN(p.housingFund))
        return '公积金无效';
    if (Number.isNaN(p.taxWithheld))
        return '代扣个税无效';
    if (Number.isNaN(p.netSalary))
        return '实发工资无效';
    const expected = p.socialInsurance + p.housingFund + p.taxWithheld + p.netSalary;
    const diff = Math.abs(expected - p.grossSalary);
    // 允许 1 分误差（0.01 元），应对浮点四舍五入
    if (diff > 0.01) {
        return `应发(${p.grossSalary.toFixed(2)}) ≠ 社保+公积金+个税+实发(${expected.toFixed(2)})，差 ${diff.toFixed(2)}`;
    }
    return null;
}
// 导入工资记录
// Excel 列：姓名 / 身份证号 / 应发 / 社保 / 公积金 / 个税 / 实发
async function importPayrolls(subjectId, fileBuffer, fileName, userId, period) {
    if (!isValidPeriod(period)) {
        // period 格式不合法，直接构造失败批次
        const batch = await prisma_1.default.importBatch.create({
            data: {
                subjectId,
                dataType: 'PAYROLL',
                fileName,
                totalCount: 0,
                successCount: 0,
                failedCount: 0,
                errors: JSON.stringify([{ row: 0, reason: `所属期格式无效: ${period}，应为 YYYY-MM（月份01-12）` }]),
                status: 'FAILED',
                createdBy: userId,
            },
        });
        return { batch, successCount: 0, failedCount: 0, skippedCount: 0, errors: [{ row: 0, reason: `所属期格式无效: ${period}` }] };
    }
    const wb = xlsx.read(fileBuffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const rows = sheetName
        ? xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
        : [];
    const rawList = [];
    for (const row of rows) {
        rawList.push({
            employeeName: cellStr(pick(row, ['姓名', 'employeeName', '员工姓名'])),
            employeeIdNo: cellStr(pick(row, ['身份证号', '身份证', 'employeeIdNo'])) || null,
            grossSalary: cellNum(pick(row, ['应发', '应发工资', 'grossSalary'])),
            socialInsurance: cellNum(pick(row, ['社保', '社会保险', 'socialInsurance'])) || 0,
            housingFund: cellNum(pick(row, ['公积金', 'housingFund'])) || 0,
            taxWithheld: cellNum(pick(row, ['个税', '代扣个税', '个人所得税', 'taxWithheld'])) || 0,
            netSalary: cellNum(pick(row, ['实发', '实发工资', 'netSalary'])),
        });
    }
    return persistImport({
        subjectId,
        fileName,
        userId,
        dataType: 'PAYROLL',
        rawList,
        validate: validatePayroll,
        dedupKeyStr: () => null,
        existingQuery: async () => new Set(),
        createOne: async (tx, p, batchNo) => {
            await tx.payrollRecord.create({
                data: {
                    subjectId,
                    employeeName: p.employeeName,
                    employeeIdNo: p.employeeIdNo,
                    period,
                    grossSalary: p.grossSalary,
                    socialInsurance: p.socialInsurance,
                    housingFund: p.housingFund,
                    taxWithheld: p.taxWithheld,
                    netSalary: p.netSalary,
                    importBatch: batchNo,
                },
            });
        },
    });
}
// 通用导入流程：
// 1. 创建 PROCESSING 批次
// 2. 事务内逐行校验 -> 去重 -> 入库，单条失败不影响其他行
//    去重同时考虑：DB 中已存在 + 本批次已插入（防同文件内重复行）
// 3. 更新批次为 DONE，写入统计与错误 JSON
async function persistImport(params) {
    const { subjectId, fileName, userId, dataType, rawList, validate, dedupKeyStr, existingQuery, createOne } = params;
    const batchNo = generateBatchNo();
    // 1. 创建 PROCESSING 批次
    const batch = await prisma_1.default.importBatch.create({
        data: {
            subjectId,
            dataType,
            fileName,
            totalCount: rawList.length,
            successCount: 0,
            failedCount: 0,
            errors: null,
            status: 'PROCESSING',
            createdBy: userId,
        },
    });
    const errors = [];
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    // 2. 事务内逐行处理
    await prisma_1.default.$transaction(async (tx) => {
        // 收集去重键字符串，预查 DB 中已存在记录
        const keys = rawList
            .map((item) => dedupKeyStr(item))
            .filter((k) => k !== null);
        let existingSet = new Set();
        if (keys.length > 0) {
            existingSet = await existingQuery(tx, keys);
        }
        // 本批次已插入的去重键集合，防止同一文件内重复行二次入库
        const insertedSet = new Set();
        for (let i = 0; i < rawList.length; i++) {
            const row = i + 1; // 数据行号：表头后第一行为 1
            const item = rawList[i];
            try {
                // 校验
                const err = validate(item);
                if (err) {
                    errors.push({ row, reason: err });
                    failedCount++;
                    continue;
                }
                // 去重：DB 已存在 或 本批次已插入
                const kstr = dedupKeyStr(item);
                if (kstr !== null && (existingSet.has(kstr) || insertedSet.has(kstr))) {
                    skippedCount++;
                    continue;
                }
                // 入库
                await createOne(tx, item, batchNo);
                successCount++;
                if (kstr !== null)
                    insertedSet.add(kstr);
            }
            catch (e) {
                const reason = e instanceof Error ? e.message : '入库失败';
                errors.push({ row, reason });
                failedCount++;
            }
        }
        // 3. 更新批次状态
        const status = failedCount === rawList.length && rawList.length > 0 ? 'FAILED' : 'DONE';
        await tx.importBatch.update({
            where: { id: batch.id },
            data: {
                successCount,
                failedCount,
                errors: errors.length > 0 ? JSON.stringify(errors) : null,
                status,
            },
        });
    });
    // 重新查询批次，返回最终状态
    const finalBatch = await prisma_1.default.importBatch.findUnique({ where: { id: batch.id } });
    // 数据导入成功后异步触发风险扫描（不阻塞导入响应，满足 5 秒内扫描要求）
    if (successCount > 0) {
        (0, riskScanService_1.onDataImported)(subjectId, dataType);
    }
    return {
        batch: finalBatch ?? batch,
        successCount,
        failedCount,
        skippedCount,
        errors,
    };
}
// ============ 序列化辅助（供 controller 使用） ============
// 将 Decimal 字段转为 number，便于 JSON 响应
function serializeInvoice(inv) {
    return {
        ...inv,
        amountExclTax: Number(inv.amountExclTax),
        taxAmount: Number(inv.taxAmount),
        amountInclTax: Number(inv.amountInclTax),
        taxRate: Number(inv.taxRate),
        billingDate: inv.billingDate.toISOString(),
        createdAt: inv.createdAt.toISOString(),
    };
}
function serializeBankTransaction(t) {
    return {
        ...t,
        amount: Number(t.amount),
        transDate: t.transDate.toISOString(),
        createdAt: t.createdAt.toISOString(),
    };
}
function serializePayroll(p) {
    return {
        ...p,
        grossSalary: Number(p.grossSalary),
        socialInsurance: Number(p.socialInsurance),
        housingFund: Number(p.housingFund),
        taxWithheld: Number(p.taxWithheld),
        netSalary: Number(p.netSalary),
        createdAt: p.createdAt.toISOString(),
    };
}
function serializeBatch(b) {
    return {
        ...b,
        errors: b.errors ? JSON.parse(b.errors) : null,
        createdAt: b.createdAt.toISOString(),
    };
}
