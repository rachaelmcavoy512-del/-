// 凭证记账路由（Task3）
// 挂载在 /api/vouchers，所有接口均需 authenticate
import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { logAction } from '../middlewares/audit';
import {
  create,
  list,
  detail,
  post,
  voidVoucherCtrl,
  redOffset,
  update,
  remove,
  periodCloseCtrl,
  balances,
  accountBalance,
} from '../controllers/voucherController';

const router = Router();

// 所有凭证接口都需要登录
router.use(authenticate);

// ============ 静态路径优先于 /:id ============

// 创建凭证（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('CREATE_VOUCHER', 'voucher'),
  create
);

// 列表查询（所有登录用户可查）
router.get('/', list);

// 期末结转（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/period-close',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('PERIOD_CLOSE', 'voucher'),
  periodCloseCtrl
);

// 科目余额表（所有登录用户可查）
router.get('/balances', balances);

// 单科目余额（所有登录用户可查）
router.get('/accounts/:accountId/balance', accountBalance);

// ============ 按 :id 路由 ============

// 凭证详情（含 entries + account）
router.get('/:id', detail);

// 过账（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/:id/post',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('POST_VOUCHER', 'voucher'),
  post
);

// 作废（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/:id/void',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('VOID_VOUCHER', 'voucher'),
  voidVoucherCtrl
);

// 红冲（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/:id/red-offset',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('RED_OFFSET_VOUCHER', 'voucher'),
  redOffset
);

// 修改凭证（仅 DRAFT 可改）
router.put(
  '/:id',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('UPDATE_VOUCHER', 'voucher'),
  update
);

// 删除凭证（仅 DRAFT 可删）
router.delete(
  '/:id',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('DELETE_VOUCHER', 'voucher'),
  remove
);

export default router;
