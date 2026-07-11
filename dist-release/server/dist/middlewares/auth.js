"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signToken = signToken;
exports.authenticate = authenticate;
exports.optionalAuth = optionalAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_EXPIRES_IN = '7d';
// 签发 JWT token（有效期 7 天）
function signToken(userId, role) {
    return jsonwebtoken_1.default.sign({ id: userId, role }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
    });
}
// 必须认证：解析 Authorization Bearer token，校验并注入 req.user，失败返回 401
function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未登录' });
    }
    const token = header.slice(7);
    try {
        const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = { id: payload.id, role: payload.role };
        next();
    }
    catch {
        return res.status(401).json({ error: 'token无效或已过期' });
    }
}
// 可选认证：有合法 token 则注入 req.user，无 token 或 token 非法均放行
function optionalAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return next();
    }
    const token = header.slice(7);
    try {
        const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = { id: payload.id, role: payload.role };
    }
    catch {
        // token 非法则忽略，继续放行
    }
    next();
}
