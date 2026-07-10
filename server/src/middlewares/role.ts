import { Request, Response, NextFunction } from 'express';

// 角色权限校验中间件工厂：requireRole('ADMIN') 或 requireRole('ADMIN', 'ACCOUNTANT')
// 校验 req.user.role 是否在允许列表内，否则返回 403
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '无权限' });
    }
    next();
  };
}
