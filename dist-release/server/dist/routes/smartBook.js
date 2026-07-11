"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 智能记账路由（新手友好）
// 挂载在 /api/smart-book，全部需要 authenticate
// generate/post/assign 需 ADMIN/ACCOUNTANT + logAction 审计
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const role_1 = require("../middlewares/role");
const audit_1 = require("../middlewares/audit");
const smartBookController_1 = require("../controllers/smartBookController");
const router = (0, express_1.Router)();
// 所有智能记账接口都需要登录
router.use(auth_1.authenticate);
// GET /api/smart-book/preview  预览（不落库）
router.get('/preview', smartBookController_1.preview);
// POST /api/smart-book/generate  生成记账（ADMIN/ACCOUNTANT）+ 审计
router.post('/generate', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('SMART_BOOK_GENERATE', 'voucher'), smartBookController_1.generate);
// GET /api/smart-book/pending  待审核凭证列表
router.get('/pending', smartBookController_1.pending);
// POST /api/smart-book/post  批量过账（ADMIN/ACCOUNTANT）+ 审计
router.post('/post', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('SMART_BOOK_POST', 'voucher'), smartBookController_1.post);
// GET /api/smart-book/unidentified  无法识别的银行流水
router.get('/unidentified', smartBookController_1.unidentified);
// POST /api/smart-book/assign  人工指定科目（ADMIN/ACCOUNTANT）+ 审计
router.post('/assign', (0, role_1.requireRole)('ADMIN', 'ACCOUNTANT'), (0, audit_1.logAction)('SMART_BOOK_ASSIGN', 'voucher'), smartBookController_1.assign);
exports.default = router;
