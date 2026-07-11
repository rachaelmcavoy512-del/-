// 智能记账控制器（新手友好）
// 处理 HTTP 请求/响应，zod 校验，调用 smartBookService
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  previewBookings,
  generateBookings,
  getPendingReview,
  batchPost,
  getUnidentified,
  assignManualEntry,
} from '../services/smartBookService';

// ============ 校验 schema ============

const DATA_TYPES = ['INVOICE', 'BANK', 'PAYROLL'] as const;

const previewSchema = z.object({
  subjectId: z.coerce.number().int().positive('主体ID无效'),
  dataType: z.enum(DATA_TYPES).optional(),
});

const generateSchema = z.object({
  subjectId: z.coerce.number().int().positive('主体ID无效'),
  dataType: z.enum(DATA_TYPES).optional(),
});

const postSchema = z.object({
  voucherIds: z.array(z.number().int().positive()).min(1, '至少选择一条凭证'),
});

const assignSchema = z.object({
  subjectId: z.coerce.number().int().positive('主体ID无效'),
  bankTransactionId: z.number().int().positive('流水ID无效'),
  accountId: z.number().int().positive('科目ID无效'),
});

// ============ 控制器 ============

// GET /api/smart-book/preview?subjectId=&dataType=
export async function preview(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = previewSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const { subjectId, dataType } = parsed.data;
    const result = await previewBookings(subjectId, dataType);
    return res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

// POST /api/smart-book/generate
export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const { subjectId, dataType } = parsed.data;
    const result = await generateBookings(subjectId, req.user!.id, dataType);
    return res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

// GET /api/smart-book/pending?subjectId=
export async function pending(req: Request, res: Response, next: NextFunction) {
  try {
    const subjectId = Number(req.query.subjectId);
    if (Number.isNaN(subjectId)) {
      return res.status(400).json({ error: '主体ID无效' });
    }
    const result = await getPendingReview(subjectId);
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/smart-book/post  批量过账
export async function post(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = postSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const result = await batchPost(parsed.data.voucherIds, req.user!.id);
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

// GET /api/smart-book/unidentified?subjectId=
export async function unidentified(req: Request, res: Response, next: NextFunction) {
  try {
    const subjectId = Number(req.query.subjectId);
    if (Number.isNaN(subjectId)) {
      return res.status(400).json({ error: '主体ID无效' });
    }
    const result = await getUnidentified(subjectId);
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/smart-book/assign  人工指定科目
export async function assign(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', detail: parsed.error.flatten() });
    }
    const { subjectId, bankTransactionId, accountId } = parsed.data;
    const voucher = await assignManualEntry(subjectId, bankTransactionId, accountId, req.user!.id);
    return res.status(201).json(voucher);
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}
