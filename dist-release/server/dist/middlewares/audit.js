"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAuditChain = void 0;
exports.logAction = logAction;
const auditRepo_1 = __importDefault(require("../repositories/auditRepo"));
// 需要脱敏的字段名（小写匹配）：不写入审计日志 detail
const SENSITIVE_KEYS = ['password', 'passwordhash', 'token', 'secret'];
// 从 req.body / req.params 中提取关键变更信息并脱敏
// - 跳过密码、token 等敏感字段
// - 始终记录 params.id
function buildDetail(req) {
    const parts = [];
    // 记录路径参数（如 id）
    const paramKeys = Object.keys(req.params || {});
    if (paramKeys.length) {
        parts.push(`params:${JSON.stringify(req.params)}`);
    }
    // 记录 body 关键字段，跳过敏感字段
    const body = req.body;
    if (body && typeof body === 'object' && Object.keys(body).length) {
        const safe = {};
        for (const [k, v] of Object.entries(body)) {
            if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
                safe[k] = '***';
            }
            else {
                safe[k] = v;
            }
        }
        parts.push(`body:${JSON.stringify(safe)}`);
    }
    return parts.length ? parts.join(';') : null;
}
// 审计日志中间件工厂：logAction('创建用户', 'user')
// 在响应结束后异步通过 auditRepo.create 写入 AuditLog，构造哈希链
// 写入失败仅记录日志，不影响业务流程
function logAction(action, target) {
    return (req, _res, next) => {
        // res.on('finish') 在响应返回后触发；此处改用 process.nextTick + 监听 finish
        // 但因为 finish 事件已能覆盖，沿用原实现
        _res.on('finish', () => {
            const targetWithId = req.params.id ? `${target}:${req.params.id}` : target;
            const detail = buildDetail(req);
            auditRepo_1.default
                .create({
                userId: req.user?.id ?? 0,
                action,
                target: targetWithId,
                ip: req.ip || '',
                detail,
            })
                .catch((err) => {
                // 审计日志写入失败不影响业务流程
                // eslint-disable-next-line no-console
                console.error('[审计日志写入失败]', err);
            });
        });
        next();
    };
}
// 重新导出审计链校验工具，便于路由层引用
var auditRepo_2 = require("../repositories/auditRepo");
Object.defineProperty(exports, "verifyAuditChain", { enumerable: true, get: function () { return auditRepo_2.verifyAuditChain; } });
