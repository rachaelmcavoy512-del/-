"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENESIS_HASH = void 0;
exports.computeHash = computeHash;
exports.create = create;
exports.findMany = findMany;
exports.findUnique = findUnique;
exports.count = count;
exports.totalCount = totalCount;
exports.verifyAuditChain = verifyAuditChain;
const prisma_1 = __importDefault(require("../utils/prisma"));
const crypto_1 = __importDefault(require("crypto"));
// 受限的审计日志仓储：只暴露 create / findMany / findUnique / count
// 不暴露 update / delete，避免应用层任意篡改审计链
// 首条日志的 prevHash 占位值
exports.GENESIS_HASH = 'GENESIS';
// 计算单条日志的 hash = sha256(prevHash|userId|action|target|ip|detail|createdAtISO)
// detail 为 null/undefined 时按空串处理，createdAtISO 使用 toISOString()
function computeHash(params) {
    const raw = [
        params.prevHash,
        String(params.userId),
        params.action,
        params.target,
        params.ip,
        params.detail ?? '',
        params.createdAt.toISOString(),
    ].join('|');
    return crypto_1.default.createHash('sha256').update(raw, 'utf8').digest('hex');
}
// 在事务内创建审计日志：
// 1. 查询当前最大 seq
// 2. 取上一条记录的 hash 作为 prevHash（无则 GENESIS）
// 3. 计算 hash
// 4. 写入新记录
// 返回写入后的记录
async function create(input) {
    return prisma_1.default.$transaction(async (tx) => {
        // 事务内查询最大 seq 与上一条 hash
        const last = await tx.auditLog.findFirst({
            orderBy: { seq: 'desc' },
            select: { seq: true, hash: true },
        });
        const seq = last ? last.seq + 1 : 1;
        const prevHash = last ? last.hash : exports.GENESIS_HASH;
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
async function findMany(args) {
    return prisma_1.default.auditLog.findMany(args);
}
// 受限的 findUnique
async function findUnique(args) {
    return prisma_1.default.auditLog.findUnique(args);
}
// 受限的 count
async function count(args) {
    return prisma_1.default.auditLog.count(args);
}
// 查询审计链总数（用于 verify 返回 total）
async function totalCount() {
    return prisma_1.default.auditLog.count();
}
// 审计链完整性校验：
// 从头遍历 AuditLog，按 seq 升序：
// - 首条 prevHash 应为 GENESIS
// - 其余 prevHash 应等于上一条 hash
// - 每条 hash 等于重算值
// 返回 { valid, brokenAt?, total }
async function verifyAuditChain() {
    const logs = await prisma_1.default.auditLog.findMany({
        orderBy: { seq: 'asc' },
    });
    const total = logs.length;
    let prevHash = exports.GENESIS_HASH;
    for (const log of logs) {
        // 校验 prevHash 是否等于上一条 hash
        if (log.prevHash !== prevHash) {
            return { valid: false, brokenAt: log.seq, total };
        }
        // 校验本条 hash 是否等于重算值
        const recomputed = computeHash({
            prevHash: log.prevHash ?? exports.GENESIS_HASH,
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
exports.default = {
    create,
    findMany,
    findUnique,
    count,
    totalCount,
    verifyAuditChain,
    computeHash,
    GENESIS_HASH: exports.GENESIS_HASH,
};
