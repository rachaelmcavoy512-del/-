import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_EXPIRES_IN = '7d';

export interface JwtPayload {
  id: number;
  role: string;
}

// 签发 JWT token（有效期 7 天）
export function signToken(userId: number, role: string): string {
  return jwt.sign({ id: userId, role } as JwtPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

// 必须认证：解析 Authorization Bearer token，校验并注入 req.user，失败返回 401
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'token无效或已过期' });
  }
}

// 可选认证：有合法 token 则注入 req.user，无 token 或 token 非法均放行
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next();
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = { id: payload.id, role: payload.role };
  } catch {
    // token 非法则忽略，继续放行
  }
  next();
}
