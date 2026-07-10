// 财务报表控制器（Task4）
// 处理 HTTP 请求/响应，解析 query 参数，调用 reportService 完成报表计算
import { Request, Response, NextFunction } from 'express';
import {
  getBalanceSheet,
  getIncomeStatement,
  getCashFlowStatement,
  getTrialBalance,
  getGeneralLedger,
  getSubsidiaryLedger,
} from '../services/reportService';

// rangeType 取值
const RANGE_TYPES = ['MONTH', 'QUARTER', 'YEAR'];

// 业务错误统一返回 400，其他错误透传给全局错误处理（500）
function handleServiceError(res: Response, err: unknown) {
  if (err instanceof Error) {
    return res.status(400).json({ error: err.message });
  }
  return undefined;
}

// 解析 subjectId / year / period 等通用 query 参数
function parseCommonQuery(req: Request) {
  const subjectId = parseInt(String(req.query.subjectId), 10);
  const year = parseInt(String(req.query.year), 10);
  const period = parseInt(String(req.query.period), 10);
  return { subjectId, year, period };
}

// GET /api/reports/balance-sheet  ?subjectId=&year=&period=
export async function balanceSheet(req: Request, res: Response, next: NextFunction) {
  try {
    const { subjectId, year, period } = parseCommonQuery(req);
    if (Number.isNaN(subjectId) || Number.isNaN(year) || Number.isNaN(period)) {
      return res.status(400).json({ error: '请提供 subjectId、year、period 参数' });
    }
    if (period < 1 || period > 12) {
      return res.status(400).json({ error: 'period 须为 1-12' });
    }
    const result = await getBalanceSheet(subjectId, year, period);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err) || next(err);
  }
}

// GET /api/reports/income-statement  ?subjectId=&year=&period=&rangeType=
export async function incomeStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const { subjectId, year, period } = parseCommonQuery(req);
    if (Number.isNaN(subjectId) || Number.isNaN(year) || Number.isNaN(period)) {
      return res.status(400).json({ error: '请提供 subjectId、year、period 参数' });
    }
    if (period < 1 || period > 12) {
      return res.status(400).json({ error: 'period 须为 1-12' });
    }
    const rangeType = String(req.query.rangeType ?? 'MONTH');
    if (!RANGE_TYPES.includes(rangeType)) {
      return res.status(400).json({ error: 'rangeType 须为 MONTH/QUARTER/YEAR' });
    }
    const result = await getIncomeStatement(subjectId, year, period, rangeType);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err) || next(err);
  }
}

// GET /api/reports/cash-flow-statement  ?subjectId=&year=&period=&rangeType=
export async function cashFlowStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const { subjectId, year, period } = parseCommonQuery(req);
    if (Number.isNaN(subjectId) || Number.isNaN(year) || Number.isNaN(period)) {
      return res.status(400).json({ error: '请提供 subjectId、year、period 参数' });
    }
    if (period < 1 || period > 12) {
      return res.status(400).json({ error: 'period 须为 1-12' });
    }
    const rangeType = String(req.query.rangeType ?? 'MONTH');
    if (!RANGE_TYPES.includes(rangeType)) {
      return res.status(400).json({ error: 'rangeType 须为 MONTH/QUARTER/YEAR' });
    }
    const result = await getCashFlowStatement(subjectId, year, period, rangeType);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err) || next(err);
  }
}

// GET /api/reports/trial-balance  ?subjectId=&year=&period=
export async function trialBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const { subjectId, year, period } = parseCommonQuery(req);
    if (Number.isNaN(subjectId) || Number.isNaN(year) || Number.isNaN(period)) {
      return res.status(400).json({ error: '请提供 subjectId、year、period 参数' });
    }
    if (period < 1 || period > 12) {
      return res.status(400).json({ error: 'period 须为 1-12' });
    }
    const result = await getTrialBalance(subjectId, year, period);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err) || next(err);
  }
}

// GET /api/reports/general-ledger  ?subjectId=&accountId=&year=&period=&rangeType=
export async function generalLedger(req: Request, res: Response, next: NextFunction) {
  try {
    const subjectId = parseInt(String(req.query.subjectId), 10);
    const accountId = parseInt(String(req.query.accountId), 10);
    const year = parseInt(String(req.query.year), 10);
    const period = parseInt(String(req.query.period), 10);
    if (Number.isNaN(subjectId) || Number.isNaN(accountId) || Number.isNaN(year) || Number.isNaN(period)) {
      return res.status(400).json({ error: '请提供 subjectId、accountId、year、period 参数' });
    }
    if (period < 1 || period > 12) {
      return res.status(400).json({ error: 'period 须为 1-12' });
    }
    const rangeType = String(req.query.rangeType ?? 'MONTH');
    if (!RANGE_TYPES.includes(rangeType)) {
      return res.status(400).json({ error: 'rangeType 须为 MONTH/QUARTER/YEAR' });
    }
    const result = await getGeneralLedger(subjectId, accountId, year, period, rangeType);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err) || next(err);
  }
}

// GET /api/reports/subsidiary-ledger  ?subjectId=&accountId=&from=&to=
export async function subsidiaryLedger(req: Request, res: Response, next: NextFunction) {
  try {
    const subjectId = parseInt(String(req.query.subjectId), 10);
    const accountId = parseInt(String(req.query.accountId), 10);
    const from = req.query.from ? String(req.query.from) : '';
    const to = req.query.to ? String(req.query.to) : '';
    if (Number.isNaN(subjectId) || Number.isNaN(accountId)) {
      return res.status(400).json({ error: '请提供 subjectId、accountId 参数' });
    }
    if (!from || !to) {
      return res.status(400).json({ error: '请提供 from、to 日期参数' });
    }
    const result = await getSubsidiaryLedger(subjectId, accountId, from, to);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err) || next(err);
  }
}

// GET /api/reports/refresh  no-op，报表为实时计算
export async function refresh(_req: Request, res: Response) {
  return res.json({ ok: true, message: '报表为实时计算，无需刷新' });
}
