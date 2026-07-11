import api from './client';

// ============ 类型定义 ============

// 纳税人类型
export type TaxpayerType = 'SMALL_SCALE' | 'GENERAL';

// 纳税人主体
export interface TaxpayerSubject {
  id: number;
  name: string;
  taxNumber: string;
  taxpayerType: TaxpayerType;
  industry?: string | null;
  taxRate?: number | null;
  address?: string | null;
  phone?: string | null;
  legalPerson?: string | null;
  createdAt: string;
  updatedAt: string;
  accountCount?: number;
  accounts?: Account[];
}

// 会计科目
export interface Account {
  id: number;
  subjectId: number;
  code: string;
  name: string;
  direction: 'DEBIT' | 'CREDIT';
  level: number;
  parentCode?: string | null;
  category: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'COST' | 'INCOME' | 'EXPENSE';
  isLeaf: boolean;
  balanceDirection: 'DEBIT' | 'CREDIT';
}

// 创建/更新主体入参
export interface TaxpayerInput {
  name: string;
  taxNumber: string;
  taxpayerType: TaxpayerType;
  industry?: string;
  taxRate?: number;
  address?: string;
  phone?: string;
  legalPerson?: string;
}

// 创建/更新科目入参
export interface AccountInput {
  code: string;
  name: string;
  direction: 'DEBIT' | 'CREDIT';
  level: number;
  parentCode?: string;
  category: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'COST' | 'INCOME' | 'EXPENSE';
  balanceDirection: 'DEBIT' | 'CREDIT';
  isLeaf?: boolean;
}

// ============ 纳税人主体接口 ============

// 列表查询，支持 type / keyword 过滤
export function listTaxpayers(params?: { type?: string; keyword?: string }) {
  return api.get<TaxpayerSubject[]>('/taxpayers', { params });
}

// 极简创建（新手友好）
export function quickCreateTaxpayer(data: {
  name: string;
  taxNumber: string;
  taxpayerType: TaxpayerType;
}) {
  return api.post<TaxpayerSubject>('/taxpayers/quick-create', data);
}

// 首页统计
export interface TaxpayerSummary {
  id: number;
  name: string;
  taxNumber: string;
  taxpayerType: TaxpayerType;
  riskCount: number;
  voucherCount: number;
  lastReportPeriod: string | null;
}

export function getTaxpayerSummary() {
  return api.get<TaxpayerSummary[]>('/taxpayers/summary');
}

// 详情（含科目列表）
export function getTaxpayer(id: number) {
  return api.get<TaxpayerSubject>(`/taxpayers/${id}`);
}

// 创建主体
export function createTaxpayer(data: TaxpayerInput) {
  return api.post<TaxpayerSubject>('/taxpayers', data);
}

// 更新主体
export function updateTaxpayer(id: number, data: Partial<TaxpayerInput>) {
  return api.put<TaxpayerSubject>(`/taxpayers/${id}`, data);
}

// 删除主体
export function deleteTaxpayer(id: number) {
  return api.delete<{ message: string }>(`/taxpayers/${id}`);
}

// ============ 科目接口 ============

// 获取某主体科目列表，支持 category / level 过滤
export function listAccounts(id: number, params?: { category?: string; level?: number | string }) {
  return api.get<Account[]>(`/taxpayers/${id}/accounts`, { params });
}

// 新增科目
export function createAccount(subjectId: number, data: AccountInput) {
  return api.post<Account>(`/taxpayers/${subjectId}/accounts`, data);
}

// 修改科目
export function updateAccount(subjectId: number, accountId: number, data: Partial<AccountInput>) {
  return api.put<Account>(`/taxpayers/${subjectId}/accounts/${accountId}`, data);
}

// 删除科目
export function deleteAccount(subjectId: number, accountId: number) {
  return api.delete<{ message: string }>(`/taxpayers/${subjectId}/accounts/${accountId}`);
}
