import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  importInvoices,
  importBankTransactions,
  importPayrolls,
  serializeInvoice,
  serializeBankTransaction,
  serializePayroll,
  serializeBatch,
  DATA_TYPES,
  INVOICE_DIRECTIONS,
  INVOICE_TYPES,
} from '../services/importService';

// ============ 通用工具 ============

// 解析分页参数：page 从 1 起，pageSize 默认 20，最大 100
function parsePagination(req: Request): { skip: number; take: number; page: number; pageSize: number } {
  const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
  const pageSizeRaw = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

// 校验 subjectId 存在
async function ensureSubject(subjectId: number) {
  return prisma.taxpayerSubject.findUnique({ where: { id: subjectId } });
}

// ============ 上传：发票 ============

// POST /api/imports/invoices  上传发票文件
// multipart/form-data：file + subjectId
export async function uploadInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    const subjectId = Number(req.body.subjectId);
    if (Number.isNaN(subjectId)) {
      return res.status(400).json({ error: '缺少有效的 subjectId' });
    }
    const subject = await ensureSubject(subjectId);
    if (!subject) {
      return res.status(404).json({ error: '纳税人主体不存在' });
    }
    const file = req.file;
    if (!file || !file.buffer?.length) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const result = await importInvoices(subjectId, file.buffer, file.originalname, req.user!.id);
    return res.status(201).json({
      batch: serializeBatch(result.batch),
      successCount: result.successCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
      totalCount: result.batch.totalCount,
      errors: result.errors,
    });
  } catch (err) {
    next(err);
  }
}

// ============ 上传：银行流水 ============

// POST /api/imports/bank  上传银行流水
export async function uploadBank(req: Request, res: Response, next: NextFunction) {
  try {
    const subjectId = Number(req.body.subjectId);
    if (Number.isNaN(subjectId)) {
      return res.status(400).json({ error: '缺少有效的 subjectId' });
    }
    const subject = await ensureSubject(subjectId);
    if (!subject) {
      return res.status(404).json({ error: '纳税人主体不存在' });
    }
    const file = req.file;
    if (!file || !file.buffer?.length) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const result = await importBankTransactions(subjectId, file.buffer, file.originalname, req.user!.id);
    return res.status(201).json({
      batch: serializeBatch(result.batch),
      successCount: result.successCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
      totalCount: result.batch.totalCount,
      errors: result.errors,
    });
  } catch (err) {
    next(err);
  }
}

// ============ 上传：工资表 ============

// POST /api/imports/payrolls  上传工资表，字段 file + subjectId + period
export async function uploadPayrolls(req: Request, res: Response, next: NextFunction) {
  try {
    const subjectId = Number(req.body.subjectId);
    if (Number.isNaN(subjectId)) {
      return res.status(400).json({ error: '缺少有效的 subjectId' });
    }
    const subject = await ensureSubject(subjectId);
    if (!subject) {
      return res.status(404).json({ error: '纳税人主体不存在' });
    }
    const period = String(req.body.period || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return res.status(400).json({ error: '所属期 period 格式无效，应为 YYYY-MM（月份01-12）' });
    }
    const file = req.file;
    if (!file || !file.buffer?.length) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const result = await importPayrolls(subjectId, file.buffer, file.originalname, req.user!.id, period);
    return res.status(201).json({
      batch: serializeBatch(result.batch),
      successCount: result.successCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
      totalCount: result.batch.totalCount,
      errors: result.errors,
    });
  } catch (err) {
    next(err);
  }
}

// ============ 查询：导入批次 ============

// GET /api/imports/batches  查询导入批次列表
// query: subjectId / dataType / page / pageSize
export async function listBatches(req: Request, res: Response, next: NextFunction) {
  try {
    const { skip, take, page, pageSize } = parsePagination(req);
    const where: Prisma.ImportBatchWhereInput = {};

    if (req.query.subjectId) {
      const sid = Number(req.query.subjectId);
      if (!Number.isNaN(sid)) where.subjectId = sid;
    }
    if (req.query.dataType && DATA_TYPES.includes(req.query.dataType as (typeof DATA_TYPES)[number])) {
      where.dataType = String(req.query.dataType);
    }

    const [total, items] = await Promise.all([
      prisma.importBatch.count({ where }),
      prisma.importBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return res.json({
      items: items.map(serializeBatch),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/imports/batches/:id  批次详情（含错误明细）
export async function getBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: '无效的批次 ID' });
    }
    const batch = await prisma.importBatch.findUnique({ where: { id } });
    if (!batch) {
      return res.status(404).json({ error: '批次不存在' });
    }
    return res.json(serializeBatch(batch));
  } catch (err) {
    next(err);
  }
}

// ============ 查询：发票列表 ============

// GET /api/imports/invoices  发票列表查询
// query: subjectId / from / to / direction / type / page / pageSize
export async function listInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    const { skip, take, page, pageSize } = parsePagination(req);
    const where: Prisma.InvoiceWhereInput = {};

    if (req.query.subjectId) {
      const sid = Number(req.query.subjectId);
      if (!Number.isNaN(sid)) where.subjectId = sid;
    }
    if (req.query.direction && INVOICE_DIRECTIONS.includes(req.query.direction as (typeof INVOICE_DIRECTIONS)[number])) {
      where.direction = String(req.query.direction);
    }
    if (req.query.type && INVOICE_TYPES.includes(req.query.type as (typeof INVOICE_TYPES)[number])) {
      where.invoiceType = String(req.query.type);
    }
    if (req.query.from || req.query.to) {
      const billing: Prisma.DateTimeFilter = {};
      if (req.query.from) billing.gte = new Date(String(req.query.from));
      if (req.query.to) billing.lte = new Date(String(req.query.to));
      where.billingDate = billing;
    }

    const [total, items] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy: { billingDate: 'desc' },
        skip,
        take,
      }),
    ]);

    return res.json({
      items: items.map(serializeInvoice),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}

// ============ 查询：银行流水列表 ============

// GET /api/imports/bank  流水列表查询
// query: subjectId / from / to / direction / page / pageSize
export async function listBankTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const { skip, take, page, pageSize } = parsePagination(req);
    const where: Prisma.BankTransactionWhereInput = {};

    if (req.query.subjectId) {
      const sid = Number(req.query.subjectId);
      if (!Number.isNaN(sid)) where.subjectId = sid;
    }
    if (req.query.direction) {
      const d = String(req.query.direction).toUpperCase();
      if (d === 'IN' || d === 'OUT') where.direction = d;
    }
    if (req.query.from || req.query.to) {
      const trans: Prisma.DateTimeFilter = {};
      if (req.query.from) trans.gte = new Date(String(req.query.from));
      if (req.query.to) trans.lte = new Date(String(req.query.to));
      where.transDate = trans;
    }

    const [total, items] = await Promise.all([
      prisma.bankTransaction.count({ where }),
      prisma.bankTransaction.findMany({
        where,
        orderBy: { transDate: 'desc' },
        skip,
        take,
      }),
    ]);

    return res.json({
      items: items.map(serializeBankTransaction),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}

// ============ 查询：工资记录列表 ============

// GET /api/imports/payrolls  工资列表查询
// query: subjectId / period / page / pageSize
export async function listPayrolls(req: Request, res: Response, next: NextFunction) {
  try {
    const { skip, take, page, pageSize } = parsePagination(req);
    const where: Prisma.PayrollRecordWhereInput = {};

    if (req.query.subjectId) {
      const sid = Number(req.query.subjectId);
      if (!Number.isNaN(sid)) where.subjectId = sid;
    }
    if (req.query.period) {
      where.period = String(req.query.period);
    }

    const [total, items] = await Promise.all([
      prisma.payrollRecord.count({ where }),
      prisma.payrollRecord.findMany({
        where,
        orderBy: [{ period: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return res.json({
      items: items.map(serializePayroll),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}
