import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { logAction } from '../middlewares/audit';
import {
  createTaxpayer,
  quickCreate,
  summary,
  listTaxpayers,
  getTaxpayer,
  updateTaxpayer,
  deleteTaxpayer,
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from '../controllers/taxpayerController';

const router = Router();

// 创建主体（仅 ADMIN）：创建后自动初始化科目体系，接入审计
router.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  logAction('CREATE_TAXPAYER', 'taxpayer'),
  createTaxpayer
);

// 列表查询（所有登录用户可查）
router.get('/', authenticate, listTaxpayers);

// 极简创建（仅 ADMIN）+ 审计 —— 放在 /:id 之前避免被占位
router.post(
  '/quick-create',
  authenticate,
  requireRole('ADMIN'),
  logAction('QUICK_CREATE_TAXPAYER', 'taxpayer'),
  quickCreate
);

// 首页统计（所有登录用户）—— 放在 /:id 之前避免被占位
router.get('/summary', authenticate, summary);

// 详情（含 accounts 科目列表）
router.get('/:id', authenticate, getTaxpayer);

// 更新主体基础信息（仅 ADMIN）
router.put(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  logAction('UPDATE_TAXPAYER', 'taxpayer'),
  updateTaxpayer
);

// 删除主体（仅 ADMIN），级联删除科目
router.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  logAction('DELETE_TAXPAYER', 'taxpayer'),
  deleteTaxpayer
);

// 获取某主体科目列表（按 code 排序，可 query ?category=&level=）
router.get('/:id/accounts', authenticate, listAccounts);

// 新增自定义科目（ADMIN/ACCOUNTANT）
router.post(
  '/:id/accounts',
  authenticate,
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('CREATE_ACCOUNT', 'account'),
  createAccount
);

// 修改科目
router.put(
  '/:id/accounts/:accountId',
  authenticate,
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('UPDATE_ACCOUNT', 'account'),
  updateAccount
);

// 删除科目
router.delete(
  '/:id/accounts/:accountId',
  authenticate,
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('DELETE_ACCOUNT', 'account'),
  deleteAccount
);

export default router;
