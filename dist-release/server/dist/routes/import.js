"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../middlewares/auth");
const role_1 = require("../middlewares/role");
const audit_1 = require("../middlewares/audit");
const importController_1 = require("../controllers/importController");
const router = (0, express_1.Router)();
// multer 内存存储：文件暂存于内存，由 controller 传入 service 解析
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 单文件最大 20MB
});
// multer 中间件类型来自 workspace 根目录的 @types/express-serve-static-core@5.x，
// 与本工作区 server 的 @types/express-serve-static-core@4.x 类型不兼容（仅类型层面，运行时正常）。
// 此处统一转换为 server 的 RequestHandler 类型以消除类型冲突。
const singleFile = (fieldName) => upload.single(fieldName);
// 所有导入接口都需要登录
router.use(auth_1.authenticate);
// ============ 上传接口（ADMIN / ACCOUNTANT） ============
// POST /api/imports/invoices  上传发票文件
router.post('/invoices', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), singleFile('file'), (0, audit_1.logAction)('IMPORT_INVOICES', 'invoice'), importController_1.uploadInvoices);
// POST /api/imports/bank  上传银行流水
router.post('/bank', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), singleFile('file'), (0, audit_1.logAction)('IMPORT_BANK', 'bank_transaction'), importController_1.uploadBank);
// POST /api/imports/payrolls  上传工资表
router.post('/payrolls', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), singleFile('file'), (0, audit_1.logAction)('IMPORT_PAYROLLS', 'payroll_record'), importController_1.uploadPayrolls);
// ============ 查询接口（所有登录用户可查） ============
// GET /api/imports/batches  批次列表
router.get('/batches', importController_1.listBatches);
// GET /api/imports/batches/:id  批次详情
router.get('/batches/:id', importController_1.getBatch);
// GET /api/imports/invoices  发票列表
router.get('/invoices', importController_1.listInvoices);
// GET /api/imports/bank  流水列表
router.get('/bank', importController_1.listBankTransactions);
// GET /api/imports/payrolls  工资列表
router.get('/payrolls', importController_1.listPayrolls);
exports.default = router;
