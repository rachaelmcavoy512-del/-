"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 税务申报路由（Task6）
// 挂载在 /api/tax-returns，所有接口均需 authenticate
// 生成/修改状态权限：ADMIN / ACCOUNTANT
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const role_1 = require("../middlewares/role");
const audit_1 = require("../middlewares/audit");
const taxReturnController_1 = require("../controllers/taxReturnController");
const router = (0, express_1.Router)();
// 所有税务申报接口都需要登录
router.use(auth_1.authenticate);
// ============ 静态路径优先于 /:id ============
// 生成申报表（ADMIN/ACCOUNTANT）+ 审计
router.post('/generate', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('GENERATE_TAX_RETURN', 'taxReturn'), taxReturnController_1.generate);
// 查询应纳增值税额（附加税基础预览，所有登录用户可查）
router.get('/vat-payable', taxReturnController_1.vatPayable);
// 列表查询（所有登录用户可查）
router.get('/', taxReturnController_1.list);
// ============ 按 :id 路由 ============
// 申报详情（含 reportData 解析，所有登录用户可查）
router.get('/:id', taxReturnController_1.detail);
// 导出申报表为 Excel（所有登录用户可导出）
router.get('/:id/export', taxReturnController_1.exportExcel);
// 更新申报状态（ADMIN/ACCOUNTANT）+ 审计
router.put('/:id/status', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('UPDATE_TAX_RETURN_STATUS', 'taxReturn'), taxReturnController_1.updateStatus);
exports.default = router;
