import { Router, RequestHandler } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { logAction } from '../middlewares/audit';
import {
  uploadInvoices,
  uploadBank,
  uploadPayrolls,
  listBatches,
  getBatch,
  listInvoices,
  listBankTransactions,
  listPayrolls,
} from '../controllers/importController';

const router = Router();

// multer 内存存储：文件暂存于内存，由 controller 传入 service 解析
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 单文件最大 20MB
});

// multer 中间件类型来自 workspace 根目录的 @types/express-serve-static-core@5.x，
// 与本工作区 server 的 @types/express-serve-static-core@4.x 类型不兼容（仅类型层面，运行时正常）。
// 此处统一转换为 server 的 RequestHandler 类型以消除类型冲突。
const singleFile = (fieldName: string): RequestHandler => upload.single(fieldName) as unknown as RequestHandler;

// 所有导入接口都需要登录
router.use(authenticate);

// ============ 上传接口（ADMIN / ACCOUNTANT） ============

// POST /api/imports/invoices  上传发票文件
router.post(
  '/invoices',
  requireRole('ADMIN', 'ACCOUNTANT'),
  singleFile('file'),
  logAction('IMPORT_INVOICES', 'invoice'),
  uploadInvoices
);

// POST /api/imports/bank  上传银行流水
router.post(
  '/bank',
  requireRole('ADMIN', 'ACCOUNTANT'),
  singleFile('file'),
  logAction('IMPORT_BANK', 'bank_transaction'),
  uploadBank
);

// POST /api/imports/payrolls  上传工资表
router.post(
  '/payrolls',
  requireRole('ADMIN', 'ACCOUNTANT'),
  singleFile('file'),
  logAction('IMPORT_PAYROLLS', 'payroll_record'),
  uploadPayrolls
);

// ============ 查询接口（所有登录用户可查） ============

// GET /api/imports/batches  批次列表
router.get('/batches', listBatches);

// GET /api/imports/batches/:id  批次详情
router.get('/batches/:id', getBatch);

// GET /api/imports/invoices  发票列表
router.get('/invoices', listInvoices);

// GET /api/imports/bank  流水列表
router.get('/bank', listBankTransactions);

// GET /api/imports/payrolls  工资列表
router.get('/payrolls', listPayrolls);

export default router;
