import api from './client';

// ============ 类型定义 ============

// 税种
export type TaxType = 'VAT' | 'CIT' | 'SURTAX' | 'IIT' | 'STAMP';

// 申报状态
export type TaxReturnStatus = 'DRAFT' | 'PENDING' | 'FILED' | 'PAID';

// 税种中文
export const TAX_TYPE_LABEL: Record<TaxType, string> = {
  VAT: '增值税',
  CIT: '企业所得税',
  SURTAX: '附加税',
  IIT: '个人所得税',
  STAMP: '印花税',
};

// 状态中文
export const STATUS_LABEL: Record<TaxReturnStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待申报',
  FILED: '已申报',
  PAID: '已缴款',
};

// 状态颜色（antd Tag）
export const STATUS_COLOR: Record<TaxReturnStatus, string> = {
  DRAFT: 'default',
  PENDING: 'processing',
  FILED: 'gold',
  PAID: 'green',
};

// 申报记录（列表/详情）
export interface TaxReturn {
  id: number;
  subjectId: number;
  taxType: TaxType;
  taxTypeLabel: string;
  period: string;
  status: TaxReturnStatus;
  statusLabel: string;
  filedAt: string | null;
  filedBy: number | null;
  paidAt: string | null;
  paidBy: number | null;
  paymentVoucher: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  subject?: {
    id: number;
    name: string;
    taxNumber: string;
    taxpayerType: 'SMALL_SCALE' | 'GENERAL';
  };
  taxAmount?: number;
  summary?: Record<string, unknown>;
  reportData?: Record<string, unknown> | null;
}

// 列表查询参数
export interface TaxReturnQuery {
  subjectId?: number;
  taxType?: TaxType;
  status?: TaxReturnStatus;
  period?: string;
  page?: number;
  pageSize?: number;
}

// 列表响应
export interface TaxReturnListResponse {
  items: TaxReturn[];
  total: number;
  page: number;
  pageSize: number;
}

// 生成申报入参
export interface GenerateInput {
  subjectId: number;
  taxType: TaxType;
  period: string;
  isAnnual?: boolean;
  urbanRate?: number;
}

// 更新状态入参
export interface UpdateStatusInput {
  status: TaxReturnStatus;
  paymentVoucher?: string | null;
}

// ============ 接口 ============

// 列表查询
export function listTaxReturns(query: TaxReturnQuery = {}) {
  return api.get<TaxReturnListResponse>('/tax-returns', { params: query });
}

// 详情
export function getTaxReturn(id: number) {
  return api.get<TaxReturn>(`/tax-returns/${id}`);
}

// 生成申报表
export function generateTaxReturn(data: GenerateInput) {
  return api.post<TaxReturn>('/tax-returns/generate', data);
}

// 更新状态
export function updateTaxReturnStatus(id: number, data: UpdateStatusInput) {
  return api.put<TaxReturn>(`/tax-returns/${id}/status`, data);
}

// 查询应纳增值税额（附加税基础预览）
export function getVatPayable(subjectId: number, period: string) {
  return api.get<{ subjectId: number; period: string; vatPayable: number }>(
    '/tax-returns/vat-payable',
    { params: { subjectId, period } }
  );
}

// 导出 Excel 下载链接（直接打开会带 token，此处返回 url 供 a 标签使用）
export function exportTaxReturnUrl(id: number): string {
  return `/api/tax-returns/${id}/export`;
}
