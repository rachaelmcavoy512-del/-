// 风险监控路由（Task7）
// 挂载在 /api/risks，所有接口均需 authenticate
import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { requireRole } from '../middlewares/role';
import { logAction } from '../middlewares/audit';
import {
  listIndicators,
  updateIndicator,
  scan,
  rescan,
  listEvents,
  getEvent,
  updateEventStatus,
  createRemediation,
  listRemediations,
  updateRemediation,
  listAssignees,
  dashboard,
  report,
  generateAdjustmentVoucherCtrl,
  resolveEventCtrl,
} from '../controllers/riskController';

const router = Router();

// 所有风险监控接口都需要登录
router.use(authenticate);

// ============ 风险看板 ============

// GET /api/risks/dashboard  风险看板（所有登录用户可查）
router.get('/dashboard', dashboard);

// ============ 风险体检报告 ============

// GET /api/risks/report?subjectId=&period=  风险体检报告（所有登录用户可查）
router.get('/report', report);

// ============ 指标库 ============

// GET /api/risks/indicators  指标库列表（所有登录用户可查）
router.get('/indicators', listIndicators);

// PUT /api/risks/indicators/:id  更新指标阈值/启用状态（仅 ADMIN）+ 审计
router.put(
  '/indicators/:id',
  requireRole('ADMIN'),
  logAction('UPDATE_RISK_INDICATOR', 'risk_indicator'),
  updateIndicator
);

// ============ 扫描 ============

// POST /api/risks/scan  手动触发扫描 + 审计
router.post(
  '/scan',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('RISK_SCAN', 'risk_event'),
  scan
);

// POST /api/risks/rescan  重新扫描（仅 ADMIN）+ 审计
router.post(
  '/rescan',
  requireRole('ADMIN'),
  logAction('RISK_RESCAN', 'risk_event'),
  rescan
);

// ============ 风险事件 ============

// GET /api/risks/events  风险事件列表（所有登录用户可查）
router.get('/events', listEvents);

// GET /api/risks/events/:id  事件详情（含整改任务）
router.get('/events/:id', getEvent);

// POST /api/risks/events/:id/adjustment-voucher  生成整改凭证（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/events/:id/adjustment-voucher',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('GENERATE_ADJUSTMENT_VOUCHER', 'risk_event'),
  generateAdjustmentVoucherCtrl
);

// POST /api/risks/events/:id/resolve  过账调整凭证并结案（ADMIN/ACCOUNTANT）+ 审计
router.post(
  '/events/:id/resolve',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('RESOLVE_RISK_EVENT', 'risk_event'),
  resolveEventCtrl
);

// PUT /api/risks/events/:id/status  更新事件状态 + 审计
router.put(
  '/events/:id/status',
  requireRole('ADMIN', 'ACCOUNTANT', 'AUDITOR'),
  logAction('UPDATE_RISK_EVENT_STATUS', 'risk_event'),
  updateEventStatus
);

// GET /api/risks/events/:id/remediations  某事件的整改任务列表
router.get('/events/:id/remediations', listRemediations);

// POST /api/risks/events/:id/remediations  创建整改任务 + 审计
router.post(
  '/events/:id/remediations',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('CREATE_RISK_REMEDIATION', 'risk_remediation'),
  createRemediation
);

// ============ 整改任务 ============

// GET /api/risks/users  可指派用户列表（用于整改任务表单下拉）
router.get('/users', listAssignees);

// PUT /api/risks/remediations/:id  更新整改任务状态 + 审计
router.put(
  '/remediations/:id',
  requireRole('ADMIN', 'ACCOUNTANT'),
  logAction('UPDATE_RISK_REMEDIATION', 'risk_remediation'),
  updateRemediation
);

export default router;
