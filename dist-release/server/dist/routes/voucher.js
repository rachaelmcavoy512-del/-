"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 凭证记账路由（Task3）
// 挂载在 /api/vouchers，所有接口均需 authenticate
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const role_1 = require("../middlewares/role");
const audit_1 = require("../middlewares/audit");
const voucherController_1 = require("../controllers/voucherController");
const router = (0, express_1.Router)();
// 所有凭证接口都需要登录
router.use(auth_1.authenticate);
// ============ 静态路径优先于 /:id ============
// 创建凭证（ADMIN/ACCOUNTANT）+ 审计
router.post('/', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('CREATE_VOUCHER', 'voucher'), voucherController_1.create);
// 列表查询（所有登录用户可查）
router.get('/', voucherController_1.list);
// 期末结转（ADMIN/ACCOUNTANT）+ 审计
router.post('/period-close', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('PERIOD_CLOSE', 'voucher'), voucherController_1.periodCloseCtrl);
// 科目余额表（所有登录用户可查）
router.get('/balances', voucherController_1.balances);
// 单科目余额（所有登录用户可查）
router.get('/accounts/:accountId/balance', voucherController_1.accountBalance);
// ============ 按 :id 路由 ============
// 凭证详情（含 entries + account）
router.get('/:id', voucherController_1.detail);
// 过账（ADMIN/ACCOUNTANT）+ 审计
router.post('/:id/post', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('POST_VOUCHER', 'voucher'), voucherController_1.post);
// 作废（ADMIN/ACCOUNTANT）+ 审计
router.post('/:id/void', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('VOID_VOUCHER', 'voucher'), voucherController_1.voidVoucherCtrl);
// 红冲（ADMIN/ACCOUNTANT）+ 审计
router.post('/:id/red-offset', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('RED_OFFSET_VOUCHER', 'voucher'), voucherController_1.redOffset);
// 修改凭证（仅 DRAFT 可改）
router.put('/:id', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('UPDATE_VOUCHER', 'voucher'), voucherController_1.update);
// 删除凭证（仅 DRAFT 可删）
router.delete('/:id', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('DELETE_VOUCHER', 'voucher'), voucherController_1.remove);
exports.default = router;
