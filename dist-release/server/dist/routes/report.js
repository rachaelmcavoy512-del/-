"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 财务报表路由（Task4）
// 挂载在 /api/reports，所有接口均需 authenticate
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const reportController_1 = require("../controllers/reportController");
const router = (0, express_1.Router)();
// 所有报表接口都需要登录
router.use(auth_1.authenticate);
// 资产负债表
router.get('/balance-sheet', reportController_1.balanceSheet);
// 利润表
router.get('/income-statement', reportController_1.incomeStatement);
// 现金流量表
router.get('/cash-flow-statement', reportController_1.cashFlowStatement);
// 试算平衡表 / 科目余额表
router.get('/trial-balance', reportController_1.trialBalance);
// 总账
router.get('/general-ledger', reportController_1.generalLedger);
// 明细账
router.get('/subsidiary-ledger', reportController_1.subsidiaryLedger);
// 刷新（no-op，报表为实时计算）
router.get('/refresh', reportController_1.refresh);
exports.default = router;
