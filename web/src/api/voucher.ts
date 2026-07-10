import api from './client';

// ============ 类型定义 ============

// 凭证状态
export type VoucherStatus = 'DRAFT' | 'POSTED' | 'VOID' | 'RED_VOID';

// 凭证分录
export interface VoucherEntry {
  id?: number;
  voucherId?: number;
  accountId: number;
  summary?: string | null;
  debit: number;
  credit: number;
  account?: {
    id?: number;
    code: string;
    name: string;
    category?: string;
    direction?: string;
    balanceDirection?: string;
  };
}

// 凭证
export interface Voucher {
  id: number;
  subjectId: number;
  voucherNo: string;
  voucherDate: string;
  summary: string | null;
  attachments: number;
  status: VoucherStatus;
  createdBy: number;
  postedBy: number | null;
  postedAt: string | null;
  redOffsetVoucherId: number | null;
  createdAt: string;
  updatedAt: string;
  entries: VoucherEntry[];
  amount?: number;
}

// 列表查询参数
export interface VoucherQuery {
  subjectId?: number;
  from?: string;
  to?: string;
  status?: VoucherStatus;
  page?: number;
  pageSize?: number;
}

// 列表响应
export interface VoucherListResponse {
  items: Voucher[];
  total: number;
  page: number;
  pageSize: number;
}

// 创建/修改凭证入参
export interface VoucherInput {
  subjectId?: number;
  voucherDate: string;
  summary?: string | null;
  attachments?: number;
  entries: VoucherEntry[];
}

// 科目余额行
export interface AccountBalanceRow {
  account: {
    id: number;
    code: string;
    name: string;
    category: string;
    direction: string;
    balanceDirection: string;
    isLeaf: boolean;
  };
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}

// ============ 凭证接口 ============

// 列表查询
export function listVouchers(query: VoucherQuery = {}) {
  return api.get<VoucherListResponse>('/vouchers', { params: query });
}

// 详情
export function getVoucher(id: number) {
  return api.get<Voucher>(`/vouchers/${id}`);
}

// 创建凭证
export function createVoucher(data: VoucherInput) {
  return api.post<Voucher>('/vouchers', data);
}

// 修改凭证
export function updateVoucher(id: number, data: VoucherInput) {
  return api.put<Voucher>(`/vouchers/${id}`, data);
}

// 删除凭证
export function deleteVoucher(id: number) {
  return api.delete<{ message: string }>(`/vouchers/${id}`);
}

// 过账
export function postVoucher(id: number) {
  return api.post<Voucher>(`/vouchers/${id}/post`);
}

// 作废
export function voidVoucher(id: number) {
  return api.post<Voucher>(`/vouchers/${id}/void`);
}

// 红冲
export function redOffsetVoucher(id: number, reason?: string) {
  return api.post<Voucher>(`/vouchers/${id}/red-offset`, { reason });
}

// 期末结转
export function periodClose(subjectId: number, year: number, month: number) {
  return api.post<Voucher>('/vouchers/period-close', { subjectId, year, month });
}

// 科目余额表
export function getBalances(subjectId: number, year: number, month: number) {
  return api.get<{ items: AccountBalanceRow[] }>('/vouchers/balances', {
    params: { subjectId, year, month },
  });
}

// 单科目余额
export function getAccountBalance(subjectId: number, accountId: number, upToDate?: string) {
  return api.get<{ accountId: number; subjectId: number; balance: number; upToDate: string | null }>(
    `/vouchers/accounts/${accountId}/balance`,
    { params: { subjectId, upToDate } }
  );
}
