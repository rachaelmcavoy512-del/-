import api from './client';

// 审计日志条目（ADMIN 可见完整字段）
export interface AuditLogItem {
  id: number;
  userId: number;
  action: string;
  target: string;
  ip: string;
  detail: string | null;
  // 以下字段仅 ADMIN 可见，AUDITOR 接口不返回
  prevHash?: string;
  hash?: string;
  seq?: number;
  createdAt: string;
}

// 审计日志列表响应
export interface AuditLogListResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
}

// 审计链校验响应
export interface AuditVerifyResponse {
  valid: boolean;
  brokenAt?: number;
  total: number;
}

// 查询参数
export interface AuditLogQuery {
  userId?: number;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

// GET /api/audit  分页查询审计日志
export function listAuditLogs(query: AuditLogQuery = {}) {
  return api.get<AuditLogListResponse>('/audit', {
    params: {
      userId: query.userId,
      action: query.action,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    },
  });
}

// GET /api/audit/verify  校验审计链完整性
export function verifyAuditChain() {
  return api.get<AuditVerifyResponse>('/audit/verify');
}
