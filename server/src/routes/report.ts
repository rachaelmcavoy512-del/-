// 财务报表路由（Task4）
// 挂载在 /api/reports，所有接口均需 authenticate
import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import {
  balanceSheet,
  incomeStatement,
  cashFlowStatement,
  trialBalance,
  generalLedger,
  subsidiaryLedger,
  refresh,
} from '../controllers/reportController';

const router = Router();

// 所有报表接口都需要登录
router.use(authenticate);

// 资产负债表
router.get('/balance-sheet', balanceSheet);

// 利润表
router.get('/income-statement', incomeStatement);

// 现金流量表
router.get('/cash-flow-statement', cashFlowStatement);

// 试算平衡表 / 科目余额表
router.get('/trial-balance', trialBalance);

// 总账
router.get('/general-ledger', generalLedger);

// 明细账
router.get('/subsidiary-ledger', subsidiaryLedger);

// 刷新（no-op，报表为实时计算）
router.get('/refresh', refresh);

export default router;
