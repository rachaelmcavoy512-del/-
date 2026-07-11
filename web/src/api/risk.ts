import api from './client';

// ============ 类型定义 ============

// 风险等级
export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';
// 风险事件状态
export type RiskEventStatus = 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'IGNORED';
// 整改任务状态
export type RemediationStatus = 'TODO' | 'DOING' | 'DONE';
// 指标类别
export type RiskCategory = 'VAT' | 'CIT' | 'INVOICE' | 'FUND' | 'RELATED' | 'OTHER';

// 风险指标
export interface RiskIndicator {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string;
  thresholdHigh: string;
  thresholdMedium: string;
  thresholdLow: string | null;
  severity: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// 风险事件
export interface RiskEvent {
  id: number;
  subjectId: number;
  indicatorId: number;
  period: string | null;
  level: RiskLevel;
  metricValue: string;
  thresholdValue: string | null;
  description: string;
  suggestion: string | null;
  status: RiskEventStatus;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: number | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  // 大白话整改步骤（JSON 字符串，由后端写入）
  actionableSteps: string | null;
  // 一键整改生成的调整凭证 ID
  adjustmentVoucherId: number | null;
  indicator: {
    id: number;
    code: string;
    name: string;
    category: string;
    description: string | null;
  };
  subject: {
    id: number;
    name: string;
    taxNumber: string;
  };
  remediations?: RiskRemediation[];
}

// 整改任务
export interface RiskRemediation {
  id: number;
  eventId: number;
  assigneeId: number;
  status: RemediationStatus;
  note: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// 事件列表查询参数
export interface RiskEventQuery {
  subjectId?: number;
  level?: RiskLevel;
  status?: RiskEventStatus;
  indicatorId?: number;
  page?: number;
  pageSize?: number;
}

// 事件列表响应
export interface RiskEventListResponse {
  items: RiskEvent[];
  total: number;
  page: number;
  pageSize: number;
}

// 扫描结果
export interface ScanSummary {
  subjectId: number;
  period: string | null;
  scanned: number;
  hit: number;
  events: Array<{ id: number; indicatorCode: string; level: string; status: string }>;
}

// 风险看板
export interface RiskDashboard {
  totalEvents: number;
  byLevel: { high: number; medium: number; low: number };
  byStatus: { pending: number; inProgress: number; resolved: number; ignored: number };
  remediationRate: number;
  trend: Array<{ period: string; count: number }>;
}

// ============ 指标库接口 ============

// 可指派用户（用于整改任务表单）
export interface RiskAssignee {
  id: number;
  username: string;
  role: string;
}

// 指标库列表
export function listIndicators() {
  return api.get<RiskIndicator[]>('/risks/indicators');
}

// 可指派用户列表
export function listRiskUsers() {
  return api.get<RiskAssignee[]>('/risks/users');
}

// 更新指标
export function updateIndicator(id: number, data: Partial<RiskIndicator>) {
  return api.put<RiskIndicator>(`/risks/indicators/${id}`, data);
}

// ============ 扫描接口 ============

// 手动触发扫描
export function scanRisk(subjectId: number, period?: string) {
  return api.post<ScanSummary>('/risks/scan', { subjectId, period: period ?? null });
}

// 重新扫描
export function rescanRisk(subjectId?: number) {
  return api.post<{ results: Array<ScanSummary & { closed: number }> }>('/risks/rescan', {
    subjectId: subjectId ?? null,
  });
}

// ============ 风险事件接口 ============

// 事件列表
export function listRiskEvents(query: RiskEventQuery = {}) {
  return api.get<RiskEventListResponse>('/risks/events', { params: query });
}

// 事件详情
export function getRiskEvent(id: number) {
  return api.get<RiskEvent>(`/risks/events/${id}`);
}

// 更新事件状态
export function updateRiskEventStatus(
  id: number,
  data: { status: 'RESOLVED' | 'IGNORED' | 'IN_PROGRESS'; resolution?: string | null }
) {
  return api.put<RiskEvent>(`/risks/events/${id}/status`, data);
}

// ============ 整改任务接口 ============

// 创建整改任务
export function createRemediation(
  eventId: number,
  data: { assigneeId: number; dueDate?: string | null; note?: string | null }
) {
  return api.post<RiskRemediation>(`/risks/events/${eventId}/remediations`, data);
}

// 整改任务列表
export function listRemediations(eventId: number) {
  return api.get<RiskRemediation[]>(`/risks/events/${eventId}/remediations`);
}

// 更新整改任务状态
export function updateRemediation(
  id: number,
  data: { status: RemediationStatus; note?: string | null }
) {
  return api.put<RiskRemediation>(`/risks/remediations/${id}`, data);
}

// ============ 风险看板 ============
// 风险看板
export function getRiskDashboard(subjectId?: number) {
  return api.get<RiskDashboard>('/risks/dashboard', { params: { subjectId } });
}

// ============ 风险体检报告 ============

// 体检报告事件项
export interface ReportEvent {
  id: number;
  indicatorCode: string;
  indicatorName: string;
  level: string;
  metricValue: string;
  thresholdValue: string | null;
  plainDescription: string;
  fixSteps: string[] | null;
  suggestion: string | null;
  status: string;
  canAutoFix: boolean;
  actionableSteps: string | null;
  adjustmentVoucherId: number | null;
}

// 体检报告
export interface RiskReport {
  subjectId: number;
  subjectName: string;
  period: string | null;
  overallLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'HEALTHY';
  totalEvents: number;
  byLevel: { high: number; medium: number; low: number };
  events: ReportEvent[];
}

// 获取风险体检报告
export function getRiskReport(subjectId: number, period?: string) {
  return api.get<RiskReport>('/risks/report', { params: { subjectId, period } });
}

// ============ 一键整改 ============

// 生成整改凭证
export function generateAdjustmentVoucher(eventId: number, postImmediately?: boolean) {
  return api.post(`/risks/events/${eventId}/adjustment-voucher`, { postImmediately });
}

// 过账调整凭证并结案
export function resolveRiskEvent(eventId: number) {
  return api.post(`/risks/events/${eventId}/resolve`);
}
