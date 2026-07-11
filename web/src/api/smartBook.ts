import api from './client';

// ============ 类型定义 ============

export type DataType = 'INVOICE' | 'BANK' | 'PAYROLL';

// 预览分录
export interface PreviewEntry {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  summary: string;
}

// 预览凭证
export interface PreviewBooking {
  sourceType: 'INVOICE' | 'BANK' | 'PAYROLL';
  sourceId: number;
  sourceDesc: string;
  voucherDate: string;
  voucherSummary: string;
  entries: PreviewEntry[];
  identifiable: boolean;
}

// 无法识别的银行流水
export interface UnidentifiedBankTxn {
  id: number;
  transDate: string;
  amount: number;
  direction: string;
  counterparty: string | null;
  summary: string | null;
}

// 预览结果
export interface PreviewResult {
  bookings: PreviewBooking[];
  unidentified: UnidentifiedBankTxn[];
}

// 生成结果
export interface GenerateResult {
  generated: number;
  vouchers: unknown[];
}

// 批量过账结果
export interface BatchPostResult {
  successCount: number;
  failCount: number;
  results: Array<{ id: number; success: boolean; error?: string }>;
}

// ============ 接口 ============

// 预览
export function previewBookings(subjectId: number, dataType?: DataType) {
  return api.get<PreviewResult>('/smart-book/preview', {
    params: { subjectId, dataType },
  });
}

// 生成记账
export function generateBookings(subjectId: number, dataType?: DataType) {
  return api.post<GenerateResult>('/smart-book/generate', { subjectId, dataType });
}

// 待审核凭证列表
export function getPendingReview(subjectId: number) {
  return api.get('/smart-book/pending', { params: { subjectId } });
}

// 批量过账
export function batchPost(voucherIds: number[]) {
  return api.post<BatchPostResult>('/smart-book/post', { voucherIds });
}

// 无法识别的银行流水
export function getUnidentified(subjectId: number) {
  return api.get<UnidentifiedBankTxn[]>('/smart-book/unidentified', {
    params: { subjectId },
  });
}

// 人工指定科目
export function assignManualEntry(
  subjectId: number,
  bankTransactionId: number,
  accountId: number
) {
  return api.post('/smart-book/assign', { subjectId, bankTransactionId, accountId });
}
