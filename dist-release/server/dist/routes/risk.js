"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 风险监控路由（Task7）
// 挂载在 /api/risks，所有接口均需 authenticate
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const role_1 = require("../middlewares/role");
const audit_1 = require("../middlewares/audit");
const riskController_1 = require("../controllers/riskController");
const router = (0, express_1.Router)();
// 所有风险监控接口都需要登录
router.use(auth_1.authenticate);
// ============ 风险看板 ============
// GET /api/risks/dashboard  风险看板（所有登录用户可查）
router.get('/dashboard', riskController_1.dashboard);
// ============ 风险体检报告 ============
// GET /api/risks/report?subjectId=&period=  风险体检报告（所有登录用户可查）
router.get('/report', riskController_1.report);
// ============ 指标库 ============
// GET /api/risks/indicators  指标库列表（所有登录用户可查）
router.get('/indicators', riskController_1.listIndicators);
// PUT /api/risks/indicators/:id  更新指标阈值/启用状态（仅 ADMIN）+ 审计
router.put('/indicators/:id', (0, role_1.requireRole)('ADMIN'), (0, audit_1.logAction)('UPDATE_RISK_INDICATOR', 'risk_indicator'), riskController_1.updateIndicator);
// ============ 扫描 ============
// POST /api/risks/scan  手动触发扫描 + 审计
router.post('/scan', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('RISK_SCAN', 'risk_event'), riskController_1.scan);
// POST /api/risks/rescan  重新扫描（仅 ADMIN）+ 审计
router.post('/rescan', (0, role_1.requireRole)('ADMIN'), (0, audit_1.logAction)('RISK_RESCAN', 'risk_event'), riskController_1.rescan);
// ============ 风险事件 ============
// GET /api/risks/events  风险事件列表（所有登录用户可查）
router.get('/events', riskController_1.listEvents);
// GET /api/risks/events/:id  事件详情（含整改任务）
router.get('/events/:id', riskController_1.getEvent);
// POST /api/risks/events/:id/adjustment-voucher  生成整改凭证（ADMIN/ACCOUNTANT）+ 审计
router.post('/events/:id/adjustment-voucher', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('GENERATE_ADJUSTMENT_VOUCHER', 'risk_event'), riskController_1.generateAdjustmentVoucherCtrl);
// POST /api/risks/events/:id/resolve  过账调整凭证并结案（ADMIN/ACCOUNTANT）+ 审计
router.post('/events/:id/resolve', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('RESOLVE_RISK_EVENT', 'risk_event'), riskController_1.resolveEventCtrl);
// PUT /api/risks/events/:id/status  更新事件状态 + 审计
router.put('/events/:id/status', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT', 'AUDITOR'), (0, audit_1.logAction)('UPDATE_RISK_EVENT_STATUS', 'risk_event'), riskController_1.updateEventStatus);
// GET /api/risks/events/:id/remediations  某事件的整改任务列表
router.get('/events/:id/remediations', riskController_1.listRemediations);
// POST /api/risks/events/:id/remediations  创建整改任务 + 审计
router.post('/events/:id/remediations', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('CREATE_RISK_REMEDIATION', 'risk_remediation'), riskController_1.createRemediation);
// ============ 整改任务 ============
// GET /api/risks/users  可指派用户列表（用于整改任务表单下拉）
router.get('/users', riskController_1.listAssignees);
// PUT /api/risks/remediations/:id  更新整改任务状态 + 审计
router.put('/remediations/:id', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('UPDATE_RISK_REMEDIATION', 'risk_remediation'), riskController_1.updateRemediation);
exports.default = router;
