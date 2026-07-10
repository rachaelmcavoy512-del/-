import api from './client';

// ============ 类型定义 ============

export type RangeType = 'MONTH' | 'QUARTER' | 'YEAR';

// 资产负债表
export interface BalanceSheetItem {
  code: string;
  name: string;
  balance: number;
  lineNo: number;
  computed?: boolean;
}

export interface BalanceSheetResult {
  assets: BalanceSheetItem[];
  liabilities: BalanceSheetItem[];
  equities: BalanceSheetItem[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balanced: boolean;
  periodLabel: string;
}

// 利润表
export interface IncomeStatementItem {
  code: string;
  name: string;
  amount: number;
}

export interface IncomeStatementResult {
  incomes: IncomeStatementItem[];
  expenses: IncomeStatementItem[];
  operatingRevenue: number;
  operatingCost: number;
  periodExpenses: number;
  operatingProfit: number;
  totalProfit: number;
  netProfit: number;
  periodLabel: string;
}

// 现金流量表
export interface CashFlowItem {
  code: string;
  name: string;
  inflow: number;
  outflow: number;
}

export interface CashFlowPart {
  inflow: number;
  outflow: number;
  net: number;
  items: CashFlowItem[];
}

export interface CashFlowResult {
  operating: CashFlowPart;
  investing: CashFlowPart;
  financing: CashFlowPart;
  netChange: number;
  periodLabel: string;
}

// 试算平衡表
export interface TrialBalanceRow {
  account: {
    id: number;
    code: string;
    name: string;
    category: string;
    balanceDirection: string;
  };
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[];
  totalOpeningDebit: number;
  totalOpeningCredit: number;
  totalPeriodDebit: number;
  totalPeriodCredit: number;
  totalClosingDebit: number;
  totalClosingCredit: number;
  balanced: boolean;
  periodLabel: string;
}

// 总账
export interface GeneralLedgerRow {
  month: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}

export interface GeneralLedgerResult {
  account: { id: number; code: string; name: string; balanceDirection: string };
  openingBalance: number;
  rows: GeneralLedgerRow[];
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  periodLabel: string;
}

// 明细账
export interface SubsidiaryLedgerEntry {
  voucherId: number;
  voucherNo: string;
  voucherDate: string;
  summary: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface SubsidiaryLedgerResult {
  account: { id: number; code: string; name: string; balanceDirection: string };
  openingBalance: number;
  entries: SubsidiaryLedgerEntry[];
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

// ============ 接口封装 ============

// 资产负债表
export function getBalanceSheet(subjectId: number, year: number, period: number) {
  return api.get<BalanceSheetResult>('/reports/balance-sheet', {
    params: { subjectId, year, period },
  });
}

// 利润表
export function getIncomeStatement(
  subjectId: number,
  year: number,
  period: number,
  rangeType: RangeType
) {
  return api.get<IncomeStatementResult>('/reports/income-statement', {
    params: { subjectId, year, period, rangeType },
  });
}

// 现金流量表
export function getCashFlowStatement(
  subjectId: number,
  year: number,
  period: number,
  rangeType: RangeType
) {
  return api.get<CashFlowResult>('/reports/cash-flow-statement', {
    params: { subjectId, year, period, rangeType },
  });
}

// 试算平衡表
export function getTrialBalance(subjectId: number, year: number, period: number) {
  return api.get<TrialBalanceResult>('/reports/trial-balance', {
    params: { subjectId, year, period },
  });
}

// 总账
export function getGeneralLedger(
  subjectId: number,
  accountId: number,
  year: number,
  period: number,
  rangeType: RangeType
) {
  return api.get<GeneralLedgerResult>('/reports/general-ledger', {
    params: { subjectId, accountId, year, period, rangeType },
  });
}

// 明细账
export function getSubsidiaryLedger(
  subjectId: number,
  accountId: number,
  from: string,
  to: string
) {
  return api.get<SubsidiaryLedgerResult>('/reports/subsidiary-ledger', {
    params: { subjectId, accountId, from, to },
  });
}

// 刷新（no-op）
export function refreshReports() {
  return api.get<{ ok: boolean; message: string }>('/reports/refresh');
}
