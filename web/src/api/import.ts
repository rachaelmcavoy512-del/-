import api from './client';

// ============ 类型定义 ============

// 发票类型
export type InvoiceType = 'SPECIAL' | 'NORMAL' | 'ELECTRONIC' | 'OTHER';
// 发票方向（进项/销项）
export type InvoiceDirection = 'INPUT' | 'OUTPUT';
// 银行流水方向（收入/支出）
export type BankDirection = 'IN' | 'OUT';
// 导入数据类型
export type DataType = 'INVOICE' | 'BANK' | 'PAYROLL';
// 批次状态
export type BatchStatus = 'PROCESSING' | 'DONE' | 'FAILED';

// 单行错误详情
export interface RowError {
  row: number;
  reason: string;
  raw?: unknown;
}

// 发票
export interface Invoice {
  id: number;
  subjectId: number;
  invoiceCode: string;
  invoiceNo: string;
  invoiceType: InvoiceType;
  direction: InvoiceDirection;
  billingDate: string;
  buyerName?: string | null;
  sellerName?: string | null;
  buyerTaxNo?: string | null;
  sellerTaxNo?: string | null;
  amountExclTax: number;
  taxAmount: number;
  amountInclTax: number;
  taxRate: number;
  status: string;
  importBatch?: string | null;
  createdAt: string;
}

// 银行流水
export interface BankTransaction {
  id: number;
  subjectId: number;
  accountNo?: string | null;
  transDate: string;
  amount: number;
  direction: BankDirection;
  counterparty?: string | null;
  counterpartyAccount?: string | null;
  summary?: string | null;
  importBatch?: string | null;
  createdAt: string;
}

// 工资记录
export interface PayrollRecord {
  id: number;
  subjectId: number;
  employeeName: string;
  employeeIdNo?: string | null;
  period: string;
  grossSalary: number;
  socialInsurance: number;
  housingFund: number;
  taxWithheld: number;
  netSalary: number;
  importBatch?: string | null;
  createdAt: string;
}

// 导入批次
export interface ImportBatch {
  id: number;
  subjectId: number;
  dataType: DataType;
  fileName: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  errors: RowError[] | null;
  status: BatchStatus;
  createdBy: number;
  createdAt: string;
}

// 列表响应
export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 上传结果
export interface UploadResult {
  batch: ImportBatch;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalCount: number;
  errors: RowError[];
}

// ============ 上传接口 ============

// 上传发票文件（multipart/form-data：file + subjectId）
export function uploadInvoices(subjectId: number, file: File) {
  const form = new FormData();
  form.append('subjectId', String(subjectId));
  form.append('file', file);
  return api.post<UploadResult>('/imports/invoices', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

// 上传银行流水
export function uploadBank(subjectId: number, file: File) {
  const form = new FormData();
  form.append('subjectId', String(subjectId));
  form.append('file', file);
  return api.post<UploadResult>('/imports/bank', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

// 上传工资表（file + subjectId + period）
export function uploadPayrolls(subjectId: number, period: string, file: File) {
  const form = new FormData();
  form.append('subjectId', String(subjectId));
  form.append('period', period);
  form.append('file', file);
  return api.post<UploadResult>('/imports/payrolls', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

// ============ 查询接口 ============

// 导入批次列表
export function listBatches(params?: {
  subjectId?: number;
  dataType?: DataType;
  page?: number;
  pageSize?: number;
}) {
  return api.get<ListResponse<ImportBatch>>('/imports/batches', { params });
}

// 批次详情
export function getBatch(id: number) {
  return api.get<ImportBatch>(`/imports/batches/${id}`);
}

// 发票列表
export function listInvoices(params?: {
  subjectId?: number;
  from?: string;
  to?: string;
  direction?: InvoiceDirection;
  type?: InvoiceType;
  page?: number;
  pageSize?: number;
}) {
  return api.get<ListResponse<Invoice>>('/imports/invoices', { params });
}

// 银行流水列表
export function listBankTransactions(params?: {
  subjectId?: number;
  from?: string;
  to?: string;
  direction?: BankDirection;
  page?: number;
  pageSize?: number;
}) {
  return api.get<ListResponse<BankTransaction>>('/imports/bank', { params });
}

// 工资列表
export function listPayrolls(params?: {
  subjectId?: number;
  period?: string;
  page?: number;
  pageSize?: number;
}) {
  return api.get<ListResponse<PayrollRecord>>('/imports/payrolls', { params });
}
