import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import taxpayerRoutes from './routes/taxpayer';
import auditRoutes from './routes/audit';
import voucherRoutes from './routes/voucher';
import importRoutes from './routes/import';
import riskRoutes from './routes/risk';
import reportRoutes from './routes/report';
import taxReturnRoutes from './routes/taxReturn';

const app = express();

// 跨域支持
app.use(cors());
// JSON 请求体解析
app.use(express.json());

// 健康检查
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// 业务路由统一挂载在 /api 前缀下
app.use('/api/auth', authRoutes);
app.use('/api/taxpayers', taxpayerRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/tax-returns', taxReturnRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/risks', riskRoutes);

// 404 处理
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: '接口不存在' });
});

// 全局错误处理中间件
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[全局错误]', err);
  const message = err instanceof Error ? err.message : '服务器内部错误';
  res.status(500).json({ error: message });
});

export default app;
