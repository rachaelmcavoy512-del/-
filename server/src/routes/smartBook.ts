// 智能记账路由（新手友好）
// 挂载在 /api/smart-book，全部需要 authenticate
// generate/post/assign 需 ADMIN/ACCOUNTANT + logAction 审计
import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { logAction } from '../middlewares/audit';
import {
  preview,
  generate,
  pending,
  post,
  unidentified,
  assign,
} from '../controllers/smartBookController';

const router = Router();

// 所有智能记账接口都需要登录
router.use(authenticate);

// GET /api/smart-book/preview  预览（不落库）
router.get('/preview', preview);

// POST /api/smart-book/generate  生成记账（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/generate',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('SMART_BOOK_GENERATE', 'voucher'),
  generate
);

// GET /api/smart-book/pending  待审核凭证列表
router.get('/pending', pending);

// POST /api/smart-book/post  批量过账（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/post',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('SMART_BOOK_POST', 'voucher'),
  post
);

// GET /api/smart-book/unidentified  无法识别的银行流水
router.get('/unidentified', unidentified);

// POST /api/smart-book/assign  人工指定科目（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/assign',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('SMART_BOOK_ASSIGN', 'voucher'),
  assign
);

export default router;
