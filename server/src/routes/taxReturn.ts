// 税务申报路由（Task6）
// 挂载在 /api/tax-returns，所有接口均需 authenticate
// 生成/修改状态权限：ADMIN / ACCOUNTANT
import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { logAction } from '../middlewares/audit';
import {
  generate,
  list,
  detail,
  updateStatus,
  vatPayable,
  exportExcel,
} from '../controllers/taxReturnController';

const router = Router();

// 所有税务申报接口都需要登录
router.use(authenticate);

// ============ 静态路径优先于 /:id ============

// 生成申报表（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/generate',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('GENERATE_TAX_RETURN', 'taxReturn'),
  generate
);

// 查询应纳增值税额（附加税基础预览，所有登录用户可查）
router.get('/vat-payable', vatPayable);

// 列表查询（所有登录用户可查）
router.get('/', list);

// ============ 按 :id 路由 ============

// 申报详情（含 reportData 解析，所有登录用户可查）
router.get('/:id', detail);

// 导出申报表为 Excel（所有登录用户可导出）
router.get('/:id/export', exportExcel);

// 更新申报状态（ADMIN/ACCOUNTANT）+ 审计
router.put(
  '/:id/status',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('UPDATE_TAX_RETURN_STATUS', 'taxReturn'),
  updateStatus
);

export default router;
