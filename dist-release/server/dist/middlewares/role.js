"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
// 角色权限校验中间件工厂：requireRole('ADMIN') 或 requireRole('ADMIN', 'ACCOUNTANT')
// 校验 req.user.role 是否在允许列表内，否则返回 403
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: '未登录' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: '无权限' });
        }
        next();
    };
}
