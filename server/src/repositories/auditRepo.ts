import prisma from '../utils/prisma';
import { Prisma, AuditLog } from '@prisma/client';
import crypto from 'crypto';

// 受限的审计日志仓储：只暴露 create / findMany / findUnique / count
// 不暴露 update / delete，避免应用层任意篡改审计链

// 首条日志的 prevHash 占位值
export const GENESIS_HASH = 'GENESIS';

// 计算单条日志的 hash = sha256(prevHash|userId|action|target|ip|detail|createdAtISO)
// detail 为 null/undefined 时按空串处理，createdAtISO 使用 toISOString()
export function computeHash(params: {
  prevHash: string;
  userId: number;
  action: string;
  target: string;
  ip: string;
  detail: string | null;
  createdAt: Date;
}): string {
  const raw = [
    params.prevHash,
    String(params.userId),
    params.action,
    params.target,
    params.ip,
    params.detail ?? '',
    params.createdAt.toISOString(),
  ].join('|');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

// 创建参数
export interface CreateAuditLogInput {
  userId: number;
  action: string;
  target: string;
  ip: string;
  detail?: string | null;
}

// 在事务内创建审计日志：
// 1. 查询当前最大 seq
// 2. 取上一条记录的 hash 作为 prevHash（无则 GENESIS）
// 3. 计算 hash
// 4. 写入新记录
// 返回写入后的记录
export async function create(input: CreateAuditLogInput): Promise<AuditLog> {
  return prisma.$transaction(async (tx) => {
    // 事务内查询最大 seq 与上一条 hash
    const last = await tx.auditLog.findFirst({
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    });
    const seq = last ? last.seq + 1 : 1;
    const prevHash = last ? last.hash : GENESIS_HASH;
    const createdAt = new Date();
    const hash = computeHash({
      prevHash,
      userId: input.userId,
      action: input.action,
      target: input.target,
      ip: input.ip,
      detail: input.detail ?? null,
      createdAt,
    });

    return tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        target: input.target,
        ip: input.ip,
        detail: input.detail ?? null,
        prevHash,
        hash,
        seq,
        createdAt,
      },
    });
  });
}

// 受限的 findMany：仅查询，不允许 update/delete
export async function findMany(
  args: Prisma.AuditLogFindManyArgs
): Promise<AuditLog[]> {
  return prisma.auditLog.findMany(args);
}

// 受限的 findUnique
export async function findUnique(
  args: Prisma.AuditLogFindUniqueArgs
): Promise<AuditLog | null> {
  return prisma.auditLog.findUnique(args);
}

// 受限的 count
export async function count(args: Prisma.AuditLogCountArgs): Promise<number> {
  return prisma.auditLog.count(args);
}

// 查询审计链总数（用于 verify 返回 total）
export async function totalCount(): Promise<number> {
  return prisma.auditLog.count();
}

// 审计链完整性校验：
// 从头遍历 AuditLog，按 seq 升序：
// - 首条 prevHash 应为 GENESIS
// - 其余 prevHash 应等于上一条 hash
// - 每条 hash 等于重算值
// 返回 { valid, brokenAt?, total }
export async function verifyAuditChain(): Promise<{
  valid: boolean;
  brokenAt?: number;
  total: number;
}> {
  const logs = await prisma.auditLog.findMany({
    orderBy: { seq: 'asc' },
  });
  const total = logs.length;
  let prevHash = GENESIS_HASH;
  for (const log of logs) {
    // 校验 prevHash 是否等于上一条 hash
    if (log.prevHash !== prevHash) {
      return { valid: false, brokenAt: log.seq, total };
    }
    // 校验本条 hash 是否等于重算值
    const recomputed = computeHash({
      prevHash: log.prevHash ?? GENESIS_HASH,
      userId: log.userId,
      action: log.action,
      target: log.target,
      ip: log.ip,
      detail: log.detail,
      createdAt: log.createdAt,
    });
    if (recomputed !== log.hash) {
      return { valid: false, brokenAt: log.seq, total };
    }
    prevHash = log.hash;
  }
  return { valid: true, total };
}

export default {
  create,
  findMany,
  findUnique,
  count,
  totalCount,
  verifyAuditChain,
  computeHash,
  GENESIS_HASH,
};
