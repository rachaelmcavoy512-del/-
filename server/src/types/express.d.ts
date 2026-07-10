// Express Request 类型扩展：注入当前登录用户信息
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: string;
      };
    }
  }
}

export {};
