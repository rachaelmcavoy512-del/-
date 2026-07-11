"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const role_1 = require("../middlewares/role");
const audit_1 = require("../middlewares/audit");
const taxpayerController_1 = require("../controllers/taxpayerController");
const router = (0, express_1.Router)();
// 创建主体（仅 ADMIN）：创建后自动初始化科目体系，接入审计
router.post('/', auth_1.authenticate, (0, role_1.requireRole)('ADMIN'), (0, audit_1.logAction)('CREATE_TAXPAYER', 'taxpayer'), taxpayerController_1.createTaxpayer);
// 列表查询（所有登录用户可查）
router.get('/', auth_1.authenticate, taxpayerController_1.listTaxpayers);
// 极简创建（仅 ADMIN）+ 审计 —— 放在 /:id 之前避免被占位
router.post('/quick-create', auth_1.authenticate, (0, role_1.requireRole)('ADMIN'), (0, audit_1.logAction)('QUICK_CREATE_TAXPAYER', 'taxpayer'), taxpayerController_1.quickCreate);
// 首页统计（所有登录用户）—— 放在 /:id 之前避免被占位
router.get('/summary', auth_1.authenticate, taxpayerController_1.summary);
// 详情（含 accounts 科目列表）
router.get('/:id', auth_1.authenticate, taxpayerController_1.getTaxpayer);
// 更新主体基础信息（仅 ADMIN）
router.put('/:id', auth_1.authenticate, (0, role_1.requireRole)('ADMIN'), (0, audit_1.logAction)('UPDATE_TAXPAYER', 'taxpayer'), taxpayerController_1.updateTaxpayer);
// 删除主体（仅 ADMIN），级联删除科目
router.delete('/:id', auth_1.authenticate, (0, role_1.requireRole)('ADMIN'), (0, audit_1.logAction)('DELETE_TAXPAYER', 'taxpayer'), taxpayerController_1.deleteTaxpayer);
// 获取某主体科目列表（按 code 排序，可 query ?category=&level=）
router.get('/:id/accounts', auth_1.authenticate, taxpayerController_1.listAccounts);
// 新增自定义科目（ADMIN/ACCOUNTANT）
router.post('/:id/accounts', auth_1.authenticate, (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('CREATE_ACCOUNT', 'account'), taxpayerController_1.createAccount);
// 修改科目
router.put('/:id/accounts/:accountId', auth_1.authenticate, (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('UPDATE_ACCOUNT', 'account'), taxpayerController_1.updateAccount);
// 删除科目
router.delete('/:id/accounts/:accountId', auth_1.authenticate, (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('DELETE_ACCOUNT', 'account'), taxpayerController_1.deleteAccount);
exports.default = router;
